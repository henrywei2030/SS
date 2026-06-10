/**
 * 全局常量
 */
export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// 用户反馈 2026-05-27:扩到 6 个标准比例覆盖横屏/竖屏/方形/电影宽屏
// 顺序按用户参考图 1:横屏在前,方形居中,竖屏在后
export const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * AI 输出 → 人改 训练样本采集字段集
 * 跨 router 共用(asset.ts / storyboard.ts / aigc.ts 之前各自维护一份重复)
 *
 * SHOT / SHOT_GROUP / SCENE / ASSET 4 类 targetType 都用同一份字段名清单 —
 * 训练数据集 schema 只关心字段名是否在白名单,不关心 target 类型。
 */
export const TRAINABLE_TEXT_FIELDS = [
  // 分镜结构
  'framing',
  'angle',
  'movement',
  'lighting',
  'content',
  'prompt',
  'number',
  // 资产
  'name',
  'description',
] as const;

/**
 * 六八:声线适用范围 — 只有主演/配角需要参考声音(用户定调:群演不需要)。
 * 群演/未分类返回 false:批量生成跳过、AIGC 缺声线提示不唠叨、人物卡不显示声音状态;
 * 单个角色编辑面板的手动生成不受此限(手动 = 明确意图)。
 */
export function characterNeedsVoice(role: string | null | undefined): boolean {
  if (!role) return false;
  return role.startsWith('主演') || role.startsWith('配角');
}
