import { redirect } from 'next/navigation';

/**
 * 三十六收工 UX 改造:删"导演台首页"(原 2-card 卡片冗余)
 *   - 点击项目首页的"导演" Workbench 卡 → 直接进剧本管理(storyboard tab=script)
 *   - 顶栏"导演" HoverNav 也直进剧本管理
 *   - 剧本分析改到剧本管理页内的按钮(在 storyboard 顶部 toolbar)
 *
 * 此页保留 redirect 兜底(防外部 link / 老书签),不渲染任何 UI。
 */
export default async function DirectorHome({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<never> {
  const { id, locale } = await params;
  // v0.2.0:与顶栏「导演」HoverNav 主入口对齐到流水线第一阶段(灵感创作),消除两入口默认 tab 不一致
  redirect(`/${locale}/projects/${id}/director/storyboard?tab=inspiration`);
}
