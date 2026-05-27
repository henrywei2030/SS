/**
 * 提示词归一化工具(server + 前端共用)
 *
 * 把 LLM 输出的"双换行段间空行 + [i/N] 标题独占行"收紧成紧凑显示。
 *
 * 设计原则:
 *   - 前端 view + edit 显示用 normalize 后版本(用户看到的是这个)
 *   - server 保存 ShotGroup.prompt 时用 normalize 版本(DB 跟显示对齐)
 *   - PromptEdit 训练集 before/after 用 normalize 版本(对标真实用户改动)
 *
 * 不可逆,但视觉等价 — 训练集对齐用户实际看到/改的版本,模型学到的是正确 pair。
 */
export const normalizePrompt = (s: string): string =>
  s
    .replace(/\n{2,}/g, '\n')
    .replace(/^(\[\d+\/\d+\][^\n]+)\n(?=[^\[])/gm, '$1 ');
