/**
 * resolveBoundModelId / repointBindingsAwayFrom 单测(2026-06-08 模型绑定健壮性)。
 *
 * 锁住根因修复:binding 与 ProviderConfig 无引用完整性 → 删/停用 provider 后 binding 悬空。
 *   - resolveBoundModelId:悬空/停用/空 → 自动 fallback 同 kind active;无 active 才抛。
 *   - repointBindingsAwayFrom:删/停用前把指向它的 binding 改绑到同 kind 其它 active。
 */
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

import { resolveBoundModelId, repointBindingsAwayFrom } from './system-bindings.js';
import type { PrismaClient } from '@ss/db';

interface MockProvider {
  providerId: string;
  kind: string;
  isActive: boolean;
  displayName?: string;
}

// findFirst 按 where 三种形态返回:
//   { providerId: '<id>', kind, isActive:true } → 精确候选校验
//   { providerId: { not: '<id>' }, kind, isActive:true } → 排除自己的替代查找
//   { kind, isActive:true } → 同 kind 第一个 active(fallback)
function makeMockPrisma(
  providers: MockProvider[],
  settings: Record<string, string> = {},
): { prisma: PrismaClient; updates: Array<{ key: string; value: string }> } {
  const updates: Array<{ key: string; value: string }> = [];
  const prisma = {
    providerConfig: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let pool = providers.filter((p) => p.kind === where.kind && p.isActive);
        const pid = where.providerId;
        if (typeof pid === 'string') {
          const m = pool.find((p) => p.providerId === pid);
          return m ? { providerId: m.providerId, displayName: m.displayName ?? m.providerId } : null;
        }
        if (pid && typeof pid === 'object' && 'not' in (pid as Record<string, unknown>)) {
          const notId = (pid as { not: string }).not;
          pool = pool.filter((p) => p.providerId !== notId);
        }
        const first = pool[0];
        return first
          ? { providerId: first.providerId, displayName: first.displayName ?? first.providerId }
          : null;
      }),
    },
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        settings[where.key] !== undefined ? { value: settings[where.key] } : null,
      ),
      findMany: vi.fn(async ({ where }: { where: { value: string } }) =>
        Object.entries(settings)
          .filter(([k, v]) => k.startsWith('binding.') && v === where.value)
          .map(([key]) => ({ key })),
      ),
      update: vi.fn(
        async ({ where, data }: { where: { key: string }; data: { value: string } }) => {
          updates.push({ key: where.key, value: data.value });
          settings[where.key] = data.value;
          return {};
        },
      ),
    },
  } as unknown as PrismaClient;
  return { prisma, updates };
}

describe('resolveBoundModelId', () => {
  it('binding 值有效(存在+active+kind 匹配)→ 原样返回', async () => {
    const { prisma } = makeMockPrisma(
      [{ providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true }],
      { 'binding.inspiration.generation.modelId': 'moyu-gpt-5-4' },
    );
    const id = await resolveBoundModelId(prisma, {
      bindingKey: 'binding.inspiration.generation.modelId',
      kind: 'TEXT',
    });
    expect(id).toBe('moyu-gpt-5-4');
  });

  it('binding 悬空(provider 已删)→ 自动 fallback 同 kind 第一个 active', async () => {
    const { prisma } = makeMockPrisma(
      [{ providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true }],
      { 'binding.inspiration.generation.modelId': 'moyu-gemini-3-flash' }, // 不存在
    );
    const id = await resolveBoundModelId(prisma, {
      bindingKey: 'binding.inspiration.generation.modelId',
      kind: 'TEXT',
    });
    expect(id).toBe('moyu-gpt-5-4'); // 没硬崩,fallback
  });

  it('binding 指向已停用 provider → fallback 到另一个 active', async () => {
    const { prisma } = makeMockPrisma(
      [
        { providerId: 'moyu-claude-opus', kind: 'TEXT', isActive: false }, // 停用
        { providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true },
      ],
      { 'binding.inspiration.generation.modelId': 'moyu-claude-opus' },
    );
    const id = await resolveBoundModelId(prisma, {
      bindingKey: 'binding.inspiration.generation.modelId',
      kind: 'TEXT',
    });
    expect(id).toBe('moyu-gpt-5-4');
  });

  it('override 优先于 binding(override 有效时用 override)', async () => {
    const { prisma } = makeMockPrisma(
      [
        { providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true },
        { providerId: 'moyu-claude-sonnet', kind: 'TEXT', isActive: true },
      ],
      { 'binding.inspiration.generation.modelId': 'moyu-gpt-5-4' },
    );
    const id = await resolveBoundModelId(prisma, {
      bindingKey: 'binding.inspiration.generation.modelId',
      kind: 'TEXT',
      override: 'moyu-claude-sonnet',
    });
    expect(id).toBe('moyu-claude-sonnet');
  });

  it('override 无效 → 退回有效的 binding 值', async () => {
    const { prisma } = makeMockPrisma(
      [{ providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true }],
      { 'binding.inspiration.generation.modelId': 'moyu-gpt-5-4' },
    );
    const id = await resolveBoundModelId(prisma, {
      bindingKey: 'binding.inspiration.generation.modelId',
      kind: 'TEXT',
      override: 'ghost-model', // 不存在
    });
    expect(id).toBe('moyu-gpt-5-4');
  });

  it('该 kind 一个 active provider 都没有 → 抛 PRECONDITION_FAILED', async () => {
    const { prisma } = makeMockPrisma([], {
      'binding.inspiration.generation.modelId': 'moyu-gemini-3-flash',
    });
    await expect(
      resolveBoundModelId(prisma, {
        bindingKey: 'binding.inspiration.generation.modelId',
        kind: 'TEXT',
        purpose: '灵感创作',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('IMAGE 的悬空不会 fallback 到 TEXT(kind 隔离)', async () => {
    const { prisma } = makeMockPrisma(
      [{ providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true }], // 只有 TEXT
      { 'binding.asset.image.providerId': 'gone-image' },
    );
    await expect(
      resolveBoundModelId(prisma, {
        bindingKey: 'binding.asset.image.providerId',
        kind: 'IMAGE',
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('value 直接传入(跳过 DB 读)→ 走校验+fallback', async () => {
    const { prisma } = makeMockPrisma([
      { providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true },
    ]);
    const id = await resolveBoundModelId(prisma, {
      bindingKey: 'binding.storyboard.generation.modelId',
      kind: 'TEXT',
      value: 'stale-cached-id', // 悬空缓存值
    });
    expect(id).toBe('moyu-gpt-5-4');
    // 没传 value=undefined,不应去 findUnique 读 binding
    expect((prisma.systemSetting.findUnique as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('repointBindingsAwayFrom', () => {
  it('有 binding 指向 + 有同 kind 替代 → 全部改绑,返回明细', async () => {
    const { prisma, updates } = makeMockPrisma(
      [
        { providerId: 'moyu-gemini-3-flash', kind: 'TEXT', isActive: true }, // 被删的
        { providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true }, // 替代
      ],
      {
        'binding.inspiration.generation.modelId': 'moyu-gemini-3-flash',
        'binding.script.analysis.modelId': 'moyu-gemini-3-flash',
        'binding.storyboard.generation.modelId': 'moyu-gpt-5-4', // 不指向被删的,不动
      },
    );
    const repointed = await repointBindingsAwayFrom(prisma, {
      providerId: 'moyu-gemini-3-flash',
      kind: 'TEXT',
    });
    expect(repointed).toHaveLength(2);
    expect(repointed.every((r) => r.to === 'moyu-gpt-5-4')).toBe(true);
    expect(updates).toHaveLength(2);
  });

  it('没有 binding 指向 → 返回空,不更新', async () => {
    const { prisma, updates } = makeMockPrisma(
      [{ providerId: 'moyu-gpt-5-4', kind: 'TEXT', isActive: true }],
      { 'binding.inspiration.generation.modelId': 'moyu-gpt-5-4' },
    );
    const repointed = await repointBindingsAwayFrom(prisma, {
      providerId: 'unused-provider',
      kind: 'TEXT',
    });
    expect(repointed).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('有 binding 指向但无同 kind 替代 → 不动(留悬空给 Layer B 兜底),返回空', async () => {
    const { prisma, updates } = makeMockPrisma(
      [{ providerId: 'only-text', kind: 'TEXT', isActive: true }], // 删它后没别的 TEXT
      { 'binding.inspiration.generation.modelId': 'only-text' },
    );
    const repointed = await repointBindingsAwayFrom(prisma, {
      providerId: 'only-text',
      kind: 'TEXT',
    });
    expect(repointed).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
