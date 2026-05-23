/**
 * loadPromptTemplate — DB 优先,fallback 到 hardcoded(W7 audit R4)
 *
 * 原 3 个 LLM 入口(asset/breakdown / storyboard/generate / script/analyze)
 * SYSTEM_PROMPT 全 hardcoded,导致 W7 admin 编辑 prompt 模板 = 完全 dead UI。
 *
 * 现在统一通过此 helper:
 *   - 优先 prisma.promptTemplate.findFirst({slug, isActive:true})
 *   - DB 没有 / 不可达 → fallback 到 caller 提供的 const(原 SYSTEM_PROMPT)
 *   - 业务不会因 DB 抖动而崩
 *
 * 选 versionTag:固定取 isActive=true 最新一条(按 updatedAt desc),
 * 用户在 admin 编辑后立即生效(无缓存,每次拉 — 量小不影响性能)。
 */
import { prisma } from '@ss/db';

/**
 * 拉指定 slug 的模板正文,DB 没有时用 fallback。
 * fallback 也作为 seed 完整性兜底(部署没 seed 的环境照常跑)。
 */
export async function loadPromptTemplate(
  slug: string,
  fallback: string,
): Promise<string> {
  try {
    const t = await prisma.promptTemplate.findFirst({
      where: { slug, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { content: true },
    });
    if (t?.content?.trim()) return t.content;
  } catch (e) {
    console.warn(`[loadPromptTemplate] DB query failed for slug=${slug}, fallback:`, e);
  }
  return fallback;
}
