'use client';
import * as React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';

interface Props {
  projectId: string;
  episodeId: string;
  initialGroupId?: string;
}

export function AigcWorkspace({
  projectId,
  episodeId,
  initialGroupId,
}: Props): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const utils = trpc.useUtils();
  const { data: groups, refetch: refetchGroups } =
    trpc.aigc.listGroups.useQuery({ episodeId });

  const gFromUrl = searchParams.get('g');
  const selectedGroupId = gFromUrl ?? initialGroupId ?? groups?.[0]?.id;

  const selectGroup = (id: string): void => {
    const params = new URLSearchParams(window.location.search);
    params.set('g', id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const autoMatchMutation = trpc.aigc.autoMatchAssets.useMutation({
    onSuccess: (data) => {
      toast.success(`自动匹配:新增 ${data.created} 项,跳过 ${data.skipped} 项重复`);
      if (selectedGroupId) {
        utils.aigc.getGroupDetail.invalidate({ groupId: selectedGroupId });
      }
      void refetchGroups();
    },
    onError: (e) => toast.error(`自动匹配失败:${e.message}`),
  });

  const autoTagMutation = trpc.aigc.autoTagPrompt.useMutation({
    onSuccess: (data) => {
      if (data.changed) toast.success('已在提示词中插入 @图片N / @音频N token');
      else toast.info('没有可插入的新 token(资产已全部标记)');
      if (selectedGroupId) {
        utils.aigc.getGroupDetail.invalidate({ groupId: selectedGroupId });
        utils.aigc.previewCompiledPrompt.invalidate({ groupId: selectedGroupId });
      }
    },
    onError: (e) => toast.error(`自动 @ 失败:${e.message}`),
  });

  return (
    <div className="grid h-[calc(100vh-2.75rem)] grid-cols-[280px_1fr] gap-0 bg-[hsl(var(--color-background))]">
      {/* 左:生成段列表 */}
      <aside className="overflow-y-auto border-r border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
        <div className="sticky top-0 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-4 py-3">
          <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
            AIGC 生成段
          </div>
          <div className="mt-1 text-sm font-medium">{groups?.length ?? 0} 段</div>
        </div>
        <div className="flex flex-col gap-1 p-2">
          {(groups ?? []).map((g) => (
            <button
              key={g.id}
              onClick={() => selectGroup(g.id)}
              className={`flex flex-col items-start gap-1 rounded-md px-3 py-2.5 text-left text-sm transition ${
                selectedGroupId === g.id
                  ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                  : 'hover:bg-[hsl(var(--color-muted))]'
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="font-medium">{g.number}</span>
                <span className="text-xs opacity-60">{g.shotCount} 镜</span>
              </div>
              <div className="flex w-full items-center justify-between text-xs opacity-70">
                <span>资产 {g.bindingCount}</span>
                <span>{g.durationS.toFixed(1)}s</span>
              </div>
            </button>
          ))}
          {groups && groups.length === 0 && (
            <div className="p-4 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
              本集还没有生成段
              <br />
              先去导演工作台生成分镜
            </div>
          )}
        </div>
      </aside>

      {/* 右:详情面板 */}
      <main className="overflow-y-auto p-6">
        {selectedGroupId ? (
          <GroupDetail
            groupId={selectedGroupId}
            onAutoMatch={() => autoMatchMutation.mutate({ groupId: selectedGroupId })}
            autoMatchPending={autoMatchMutation.isPending}
            onAutoTag={() => autoTagMutation.mutate({ groupId: selectedGroupId })}
            autoTagPending={autoTagMutation.isPending}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--color-muted-foreground))]">
            选择左侧一个生成段开始
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 右侧详情:4 个 section(资产 / 剧本 / 提示词 / 预览)
// ---------------------------------------------------------------------------

interface DetailProps {
  groupId: string;
  onAutoMatch: () => void;
  autoMatchPending: boolean;
  onAutoTag: () => void;
  autoTagPending: boolean;
}

function GroupDetail({
  groupId,
  onAutoMatch,
  autoMatchPending,
  onAutoTag,
  autoTagPending,
}: DetailProps): React.ReactElement {
  const { data, isLoading } = trpc.aigc.getGroupDetail.useQuery({ groupId });
  const { data: compiled } = trpc.aigc.previewCompiledPrompt.useQuery(
    { groupId },
    { enabled: !!data },
  );

  if (isLoading || !data) {
    return (
      <div className="text-sm text-[hsl(var(--color-muted-foreground))]">
        加载中...
      </div>
    );
  }

  const { group, shots, bindings } = data;

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 group 信息 */}
      <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] pb-3">
        <div>
          <h2 className="text-lg font-semibold">{group.number}</h2>
          <div className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
            {shots.length} 个镜头 · {group.durationS.toFixed(1)}s · {group.status}
          </div>
        </div>
        <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
          group #{group.positionIdx}
        </div>
      </header>

      {/* Section 1: 资产关联 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">资产关联</h3>
          <div className="flex gap-2">
            <button
              onClick={onAutoMatch}
              disabled={autoMatchPending}
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              {autoMatchPending ? '匹配中...' : '自动匹配'}
            </button>
            <button
              disabled
              title="W5.2 v0:手动关联 / 上传素材待 W5.2.1 落地"
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs opacity-40"
            >
              关联素材
            </button>
            <button
              disabled
              title="W5.2 v0:手动关联 / 上传素材待 W5.2.1 落地"
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs opacity-40"
            >
              上传素材
            </button>
          </div>
        </div>
        {bindings.length === 0 ? (
          <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
            还没有关联资产 — 点"自动匹配"扫描提示词
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {bindings.map((b) => (
              <BindingCard key={b.id} binding={b} />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: 原始剧本(只读) */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">原始剧本</h3>
        <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] p-3 text-xs whitespace-pre-wrap leading-relaxed">
          {shots.length === 0
            ? '(无 shot)'
            : shots
                .map((s) => `${s.scene?.number ?? '?'} ${s.scene?.location ?? ''}\n${s.content || s.prompt}`)
                .join('\n\n')}
        </div>
      </section>

      {/* Section 3: 视频提示词 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">视频提示词</h3>
          <div className="flex gap-2">
            <button
              onClick={onAutoTag}
              disabled={autoTagPending}
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
            >
              {autoTagPending ? '标记中...' : '自动 @'}
            </button>
            <button
              disabled
              title="W5.2.1:行内编辑 prompt + 写 PromptEdit 训练集"
              className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs opacity-40"
            >
              编辑
            </button>
          </div>
        </div>
        <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3 text-xs whitespace-pre-wrap leading-relaxed font-mono">
          {group.prompt || '(还没有 prompt — 去导演工作台生成)'}
        </div>
        {compiled && (compiled.warnings.unknownTokens.length > 0 ||
          compiled.warnings.unusedReferences.length > 0) && (
          <div className="mt-2 space-y-1 text-xs">
            {compiled.warnings.unknownTokens.length > 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                ⚠️ 提示词里用了但未关联:{compiled.warnings.unknownTokens.join(', ')}
              </p>
            )}
            {compiled.warnings.unusedReferences.length > 0 && (
              <p className="text-[hsl(var(--color-muted-foreground))]">
                ℹ️ 关联了但未在提示词中引用:slot {compiled.warnings.unusedReferences.join(', ')}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Section 4: 视频预览(W5.4 接 Seedance) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">视频预览</h3>
          <button
            disabled
            title="W5.4:接入 Seedance API 后启用"
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs opacity-40"
          >
            生成视频
          </button>
        </div>
        <div className="flex aspect-[9/16] max-w-[280px] items-center justify-center rounded-md border border-dashed border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-xs text-[hsl(var(--color-muted-foreground))]">
          W5.4 接入 Seedance 后填充
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 资产卡片
// ---------------------------------------------------------------------------

interface BindingCardProps {
  binding: {
    id: string;
    usageType: string;
    refSlotIdx: number | null;
    kind: 'IMAGE' | 'AUDIO';
    mediaUrl: string | null;
    asset: { id: string; type: string; name: string; maturity: string };
  };
}

function BindingCard({ binding }: BindingCardProps): React.ReactElement {
  const token =
    binding.refSlotIdx != null
      ? binding.kind === 'AUDIO'
        ? `@音频${binding.refSlotIdx}`
        : `@图片${binding.refSlotIdx}`
      : '(未编号)';

  return (
    <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
      <div className="relative aspect-square bg-[hsl(var(--color-muted))]">
        {binding.mediaUrl ? (
          binding.kind === 'AUDIO' ? (
            <div className="flex h-full items-center justify-center text-2xl">🔊</div>
          ) : (
            // 图片用 img 标签直接渲染 — placeholder:// 也接受
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={binding.mediaUrl}
              alt={binding.asset.name}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
            {binding.kind === 'AUDIO' ? '无音频' : '无主图'}
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-blue-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {token}
        </span>
      </div>
      <div className="p-2">
        <div className="truncate text-xs font-medium">{binding.asset.name}</div>
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
          <span>{binding.asset.type}</span>
          <span>{binding.asset.maturity?.replace(/_.*/, '')}</span>
        </div>
      </div>
    </div>
  );
}
