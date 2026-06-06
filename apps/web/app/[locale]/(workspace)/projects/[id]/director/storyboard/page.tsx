import { StoryboardWorkspace } from './storyboard-workspace';

export default async function StoryboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ ep?: string; tab?: string }>;
}): Promise<React.ReactElement> {
  const { id, locale } = await params;
  const sp = await searchParams;
  // 五六收工:加 'breakdown' / 'inspiration' SSR 注入,跟客户端 rawTab 解析一致
  //   避免初始 ?tab=breakdown 直进时闪一下 default 再切的不一致体验
  const initialTab =
    sp.tab === 'inspiration'
      ? 'inspiration'
      : sp.tab === 'script'
        ? 'script'
        : sp.tab === 'breakdown'
          ? 'breakdown'
          : 'shots';
  return (
    <StoryboardWorkspace
      projectId={id}
      locale={locale}
      initialEpisodeId={sp.ep}
      initialTab={initialTab}
    />
  );
}
