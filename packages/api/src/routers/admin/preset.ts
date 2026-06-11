/**
 * admin.preset — 从 packages/api/src/routers/admin.ts 拆出(三十一收工 R3)
 *
 * 注:共享 admin.ts 的 import header,部分 import 在本文件可能未使用(默认 tsconfig 不强检 unused-locals)
 */
/**
 * Admin Router — 后台管理（仅 isAdmin 可访问）
 *
 * 子路由：
 *   - admin.provider  AI Provider 配置（W2 重点：API Key 在此设置）
 *   - admin.style     风格管理
 *   - admin.prompt    提示词模板
 *   - admin.system    系统设置
 *   - admin.user      全局用户管理
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router, adminProcedure } from '../../trpc.js';
import { logOperation } from '../../middleware/audit.js';

// ---------------------------------------------------------------------------
// admin.preset — W7:景别 / 机位 / 运镜 / 光线 预设
//
// 存 SystemSetting key `preset.<kind>` value JSON 数组(string[])
// 给分镜工坊编辑分镜时下拉框 + AIGC 抽卡时按预设组合 prompt
// ---------------------------------------------------------------------------

// W7 audit R6:常量 export 出去,me.listPresets / 业务 router 可复用
export const PRESET_KINDS = ['framing', 'angle', 'movement', 'lighting'] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

export const PRESET_KIND_LABELS: Record<PresetKind, string> = {
  framing: '景别',
  angle: '机位',
  movement: '运镜',
  lighting: '光线',
};

/** 默认 fallback 值(seed 没装时兜底)
 *  七二第九波(用户④:镜头语言词库优化)— 交叉通义万相/Vidu 官方 prompt 指南 + 影视摄影理论,
 *  扩成「模型吃得动 + 专业」的中文词库。⚠️ 枚举值保持**干净单术语**(会被 video.ts compileTimelinePart
 *  以 `·` 拼进【时间轴】prompt 段,带括号别名会干扰下游解析)— 别名/动机写在 storyboard 模板正文里。 */
export const PRESET_DEFAULTS: Record<PresetKind, string[]> = {
  // 景别:8 级阶梯(补大远景/中近景,细化情绪杠杆)
  framing: ['大远景', '大全景', '全景', '中景', '中近景', '近景', '特写', '大特写'],
  // 机位:平/俯/仰 + 过肩 + 专业角度(主观POV/荷兰角失衡/鸟瞰上帝视角/航拍宏大)
  angle: ['平视', '俯视', '仰视', '过肩', '主观视角', '荷兰角', '鸟瞰', '航拍'],
  // 运镜:基础六法 + 升降/甩 + 高级环绕/旋转(seedance/wan 实测支持)
  movement: ['固定', '推', '拉', '摇', '移', '跟', '升降', '环绕', '旋转', '甩'],
  // 光线:光质(自然/硬/柔)+ 光位(顶光/逆光/侧光/侧逆光/伦勃朗光)+ 调性(低/高/冷/暖)
  lighting: ['自然光', '硬光', '柔光', '顶光', '逆光', '侧光', '侧逆光', '伦勃朗光', '低调', '高调', '冷调', '暖调'],
};

/** 加载某 kind 的预设(SystemSetting preset.<kind> JSON 数组 优先,fallback DEFAULTS) */
export async function loadPresetValues(
  prismaClient: { systemSetting: { findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null> } },
  kind: PresetKind,
): Promise<{ values: string[]; isDefault: boolean }> {
  const row = await prismaClient.systemSetting.findUnique({
    where: { key: `preset.${kind}` },
  });
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return { values: parsed, isDefault: false };
      }
    } catch {
      // 损坏 JSON → fallback
    }
  }
  return { values: PRESET_DEFAULTS[kind], isDefault: true };
}

const presetRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    // 二十九收工 S7:Promise.all → allSettled,单 kind 加载失败不拖整批
    const settled = await Promise.allSettled(
      PRESET_KINDS.map(async (kind) => {
        const { values, isDefault } = await loadPresetValues(ctx.prisma, kind);
        return {
          kind,
          label: PRESET_KIND_LABELS[kind],
          values,
          isDefault,
        };
      }),
    );
    return settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const kind = PRESET_KINDS[i]!;
      // 后端 fallback:用 PRESET_DEFAULTS,前端仍可渲染
      return {
        kind,
        label: PRESET_KIND_LABELS[kind],
        values: PRESET_DEFAULTS[kind],
        isDefault: true,
      };
    });
  }),

  set: adminProcedure
    .input(
      z.object({
        kind: z.enum(PRESET_KINDS),
        values: z.array(z.string().min(1).max(50)).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const key = `preset.${input.kind}`;
      const dedup = Array.from(new Set(input.values.map((s) => s.trim()).filter(Boolean)));
      if (dedup.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '至少一个非空值' });
      }
      const before = await ctx.prisma.systemSetting.findUnique({ where: { key } });
      const setting = await ctx.prisma.systemSetting.upsert({
        where: { key },
        create: {
          key,
          value: JSON.stringify(dedup),
          category: 'preset',
          description: `${PRESET_KIND_LABELS[input.kind]} 预设列表`,
          updatedBy: ctx.user.id,
        },
        update: {
          value: JSON.stringify(dedup),
          updatedBy: ctx.user.id,
        },
      });
      await logOperation(ctx, 'preset.set', 'systemSetting', setting.id, before, setting);
      return { kind: input.kind, values: dedup };
    }),

  /** 恢复某 kind 的默认值(删 SystemSetting 行,list 会 fallback 到 PRESET_DEFAULTS) */
  resetToDefault: adminProcedure
    .input(z.object({ kind: z.enum(PRESET_KINDS) }))
    .mutation(async ({ ctx, input }) => {
      const key = `preset.${input.kind}`;
      const before = await ctx.prisma.systemSetting.findUnique({ where: { key } });
      if (!before) return { kind: input.kind, alreadyDefault: true };
      await ctx.prisma.systemSetting.delete({ where: { key } });
      await logOperation(ctx, 'preset.resetToDefault', 'systemSetting', before.id, before, null);
      return { kind: input.kind, alreadyDefault: false };
    }),
});

export { presetRouter };
