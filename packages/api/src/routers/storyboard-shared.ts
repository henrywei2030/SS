/**
 * Storyboard Router 共享件 —— 跨 procedure 复用的 helper / schema / 常量。
 *
 * 机械重构(ADR-31):从 storyboard.ts(~1847 行 god 路由)抽出,供拆分后的各 sub-module
 *   (storyboard-episode / storyboard-scene / storyboard-shot / storyboard-group /
 *   storyboard-generate)复用,破"sibling 引 helper ↔ storyboard.ts 引 sibling procedure"
 *   的循环依赖。纯搬运,无行为变化。
 */
import { TRPCError } from '@trpc/server';

// 第 18 轮 audit P1:LLM 失败错误信息脱敏(防真接 Claude 后泄漏 API URL/token)
import { TRAINABLE_TEXT_FIELDS as TRAINABLE_TEXT_FIELD_LIST } from '@ss/shared';

import type { Context } from '../context.js';
// 三十二收工 S3 followup:batch SystemSetting 读 helper
import { loadSystemSettings } from '../utils/system-bindings.js';

// W7+ audit R10:assertProjectAccess 抽到 middleware/access.ts
import { assertProjectAccess } from '../middleware/access.js';

/**
 * 性能优化:并发限流 map(自管 semaphore · 替代 p-limit 外部依赖)
 *   按输入顺序保留输出数组;每时刻最多 `limit` 个 fn() 在跑
 *   失败由 fn 自己 catch(返回 result 对象),不会 throw 中断其他任务
 */
export async function pLimitMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * 反向解析 group.prompt 为各子镜的 prompt 数组
 *
 * 新格式(r3 之后):`[1/N] framing angle <prompt>\n[2/N] framing angle <prompt>\n...`
 *   - header `[i/N]` 后到下一个 `[i/N]`(行首)或文末是该镜内容
 *   - 内容以 framing+angle 开头(若 sortedShots[i] 提供),会被自动剥离
 *   - 兼容旧格式 `[i/N] header\n<prompt>` 多行结构(整段含 framing/angle 也能跳过前缀)
 *
 * 返回 string[] (长度 = sortedShots.length) 或 null(解析失败 → 调用方 fallback 保留原 shot.prompt)
 */
export function parseGroupPromptSections(
  prompt: string,
  sortedShots: Array<{ framing: string | null; angle: string | null }>,
): string[] | null {
  const expectedCount = sortedShots.length;
  if (expectedCount <= 0) return null;
  // 匹配 [i/N] 标记位置(行首) — 仅匹配标记本身,不含后续内容
  const headerRegex = /^\[(\d+)\/(\d+)\]/gm;
  const headers: { idx: number; total: number; start: number; markerEnd: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(prompt)) !== null) {
    headers.push({
      idx: Number(m[1]),
      total: Number(m[2]),
      start: m.index,
      markerEnd: m.index + m[0].length,
    });
  }
  if (headers.length !== expectedCount) return null;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i]!.idx !== i + 1) return null;
  }
  const result: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i]!.markerEnd;
    const end = i + 1 < headers.length ? headers[i + 1]!.start : prompt.length;
    let body = prompt.slice(start, end).replace(/^[\s\n]+|[\s\n]+$/g, '');
    // 尝试剥离 "framing angle" 前缀(若 shot 字段提供 + body 开头匹配)
    const framing = (sortedShots[i]?.framing ?? '').trim();
    const angle = (sortedShots[i]?.angle ?? '').trim();
    const prefix = `${framing} ${angle}`.replace(/\s+/g, ' ').trim();
    if (prefix && body.startsWith(prefix)) {
      body = body.slice(prefix.length).replace(/^[\s\n]+/, '');
    }
    result.push(body);
  }
  return result;
}

export async function loadEpisodeOrThrow(ctx: Context, episodeId: string) {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  const ep = await ctx.prisma.episode.findFirst({
    where: { id: episodeId, deletedAt: null },
  });
  if (!ep) throw new TRPCError({ code: 'NOT_FOUND', message: '集不存在' });
  await assertProjectAccess(ctx, ep.projectId);
  return ep;
}

// ---------------------------------------------------------------------------
// 系统设置读取（modelId / maxDurationS / defaultShotDurationS）
// ---------------------------------------------------------------------------

export async function getStoryboardBindings(ctx: Context): Promise<{
  modelId: string;
  maxDurationS: number;
  defaultShotDurationS: number;
}> {
  // r8 性能优化:storyboard bindings 高频读(每次 generateForEpisode + N 场并发都走)
  // 用 cache 缓 60s · admin.system.setSetting / admin.binding.set 后会 invalidate
  // 失败 fallback 直接查 DB(降级不崩)
  const { cacheGetOrSet } = await import('@ss/queue/cache');
  const settingsMap = await cacheGetOrSet<Record<string, string>>(
    'cache:bindings:storyboard',
    60,
    async () => {
      // 三十二收工 S3 followup:helper batch
      const settings = await loadSystemSettings(ctx.prisma, [
        'binding.storyboard.generation.modelId',
        'storyboard.maxDurationS',
        'storyboard.defaultShotDurationS',
      ]);
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings)) {
        if (v !== undefined) out[k] = v;
      }
      return out;
    },
  );
  const map = new Map(Object.entries(settingsMap));
  const modelId = map.get('binding.storyboard.generation.modelId') ?? '';
  // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空时显式拒绝
  if (!modelId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '分镜生成未配置 LLM Provider — 请去 /admin/bindings 选择 binding.storyboard.generation.modelId',
    });
  }
  return {
    modelId,
    maxDurationS: Number(map.get('storyboard.maxDurationS') ?? '15'),
    defaultShotDurationS: Number(map.get('storyboard.defaultShotDurationS') ?? '3'),
  };
}

// ---------------------------------------------------------------------------
// PromptEdit 写入辅助 — 训练数据集源
//
// 只对"AI 可生成的文本字段"写训练样本，避免污染数据集：
//   - framing/angle/content/prompt 是 AI 输出 → 人改 的核心训练对
//   - durationS/priority/sceneId 等是结构/调度字段，不进训练集
// ---------------------------------------------------------------------------

/** 训练数据集只采集这些 AI 文本字段 — 从 @ss/shared 常量集中管理 */
export const TRAINABLE_TEXT_FIELDS = new Set<string>(TRAINABLE_TEXT_FIELD_LIST);

export async function recordPromptEdit(
  ctx: Context,
  args: {
    targetType: 'SHOT' | 'SHOT_GROUP' | 'SCENE';
    targetId: string;
    field: string;
    before: unknown;
    after: unknown;
    diffNote?: string;
    projectId: string;
    episodeId?: string;
    scriptId?: string;
  },
): Promise<void> {
  if (!ctx.user) return;
  // 只记可训练的文本字段
  if (!TRAINABLE_TEXT_FIELDS.has(args.field)) return;
  // 只记字符串
  if (typeof args.before !== 'string' || typeof args.after !== 'string') return;
  if (args.before === args.after) return;
  try {
    await ctx.prisma.promptEdit.create({
      data: {
        targetType: args.targetType,
        targetId: args.targetId,
        field: args.field,
        before: args.before,
        after: args.after,
        diffNote: args.diffNote,
        projectId: args.projectId,
        episodeId: args.episodeId,
        scriptId: args.scriptId,
        userId: ctx.user.id,
      },
    });
  } catch (e) {
    // 训练数据采集失败不阻塞用户操作，但记录足够上下文以便排查
    console.error('[promptEdit] failed to record:', {
      targetType: args.targetType,
      targetId: args.targetId,
      field: args.field,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
