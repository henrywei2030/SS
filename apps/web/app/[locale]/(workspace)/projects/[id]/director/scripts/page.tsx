import { redirect } from 'next/navigation';

/**
 * W6 反馈 F2+F3+F6:剧本管理 vs 分镜工坊功能重复,直接 redirect 到分镜工坊。
 *
 * 历史:
 *   - 旧 /director/scripts 是 W2.7 简版剧本列表,UploadDialog 只支持文本框粘贴,
 *     state 不 reset,跟 W3 分镜工坊的 "剧本" tab(已支持 docx/md/txt/rtf/html 文件上传)
 *     功能严重重复且体验落后
 *   - 直接 redirect 到分镜工坊,所有剧本相关功能统一在 /storyboard
 *   - 原 script-list.tsx 文件保留(以防 Phase 2 复用),但 URL 不再可达
 */
export default async function ScriptsPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<never> {
  const { id, locale } = await params;
  redirect(`/${locale}/projects/${id}/director/storyboard`);
}
