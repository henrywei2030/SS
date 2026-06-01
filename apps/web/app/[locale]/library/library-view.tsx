'use client';
import * as React from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Search,
  Upload,
  Heart,
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  File as FileIcon,
  X,
  Loader2,
  Sparkles,
  Play,
} from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BackButton } from '@/components/ui/back-button';

type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'THREE_D' | 'OTHER';
type MediaScope = 'PUBLIC' | 'PROJECT' | 'PERSONAL';
type ViewMode = 'all' | 'favorites' | 'project' | 'public';

// 四二收工:资产类别(跟 router 的 enum 对齐)· 四五收工加 VIDEO(成片归类)
type AssetCategory = 'CHARACTER' | 'SCENE' | 'PROP' | 'OTHER' | 'VIDEO';
type CategoryFilter = '' | AssetCategory | 'UNCLASSIFIED';

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  CHARACTER: '人物',
  SCENE: '场景',
  PROP: '道具',
  OTHER: '其他',
  VIDEO: '视频',
};

// chip 配色:跟 ColorBadges 系统对齐(语义色,不硬编码 tailwind 色)
const CATEGORY_CHIP_CLASS: Record<AssetCategory, string> = {
  CHARACTER: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  SCENE: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  PROP: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  OTHER: 'bg-slate-500/20 text-slate-700 dark:text-slate-300',
  VIDEO: 'bg-purple-500/20 text-purple-700 dark:text-purple-300',
};

const KIND_ICONS: Record<MediaKind, React.ComponentType<{ className?: string }>> = {
  IMAGE: ImageIcon,
  VIDEO: VideoIcon,
  AUDIO: Music,
  THREE_D: FileIcon,
  OTHER: FileIcon,
};

function inferKindFromFile(file: File): MediaKind {
  const t = file.type.toLowerCase();
  if (t.startsWith('image/')) return 'IMAGE';
  if (t.startsWith('video/')) return 'VIDEO';
  if (t.startsWith('audio/')) return 'AUDIO';
  return 'OTHER';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

export function LibraryView(): React.ReactElement {
  const utils = trpc.useUtils();
  const [view, setView] = React.useState<ViewMode>('all');
  const [kindFilter, setKindFilter] = React.useState<MediaKind | ''>('');
  const [categoryFilter, setCategoryFilter] = React.useState<CategoryFilter>(''); // 四二收工
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(48);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState<{ id: string; name: string } | null>(null);
  // 需求2:视频播放 dialog
  const [videoPreview, setVideoPreview] = React.useState<{ url: string; name: string } | null>(null);
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'zh-CN';

  const queryInput = React.useMemo(
    () => ({
      page,
      pageSize,
      scope:
        view === 'project'
          ? ('PROJECT' as const)
          : view === 'public'
            ? ('PUBLIC' as const)
            : undefined,
      kind: (kindFilter || undefined) as MediaKind | undefined,
      // 显式 narrow:'' 不是合法 router enum 值,转 undefined
      assetCategory: categoryFilter === '' ? undefined : categoryFilter,
      favorited: view === 'favorites' ? true : undefined,
      search: search.trim() || undefined,
    }),
    [view, kindFilter, categoryFilter, search, page, pageSize],
  );

  const { data, isLoading, isError, error, refetch } = trpc.media.list.useQuery(queryInput);

  React.useEffect(() => {
    setPage(1);
  }, [view, kindFilter, categoryFilter, search]);

  const toggleFavorite = trpc.media.toggleFavorite.useMutation({
    onSuccess: () => void utils.media.list.invalidate(),
    onError: (e) => toast.error(`收藏失败:${e.message}`),
  });

  const softDelete = trpc.media.softDelete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void utils.media.list.invalidate();
      setDeleteConfirm(null);
    },
    onError: (e) => toast.error(`删除失败:${e.message}`),
  });

  // 四二收工:重新归类
  const setCategory = trpc.media.setCategory.useMutation({
    onSuccess: () => {
      toast.success('已归类');
      void utils.media.list.invalidate();
    },
    onError: (e) => toast.error(`归类失败:${e.message}`),
  });

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          {/* 需求4:素材库返回按钮(全局页 → 返回项目列表) */}
          <div className="mb-2">
            <BackButton href={`/${locale}/projects`} label="返回项目列表" />
          </div>
          <h1 className="text-2xl font-semibold">素材库</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            上传/分类/搜索 · AIGC 生成物自动沉淀 · 跨项目复用
          </p>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Upload className="size-3" />
          上传素材
        </button>
      </header>

      {/* tabs */}
      <div className="mb-4 flex items-center gap-1 border-b border-[hsl(var(--color-border))]">
        {(['all', 'favorites', 'project', 'public'] as const).map((v) => {
          const labels: Record<ViewMode, string> = {
            all: '全部',
            favorites: '收藏',
            project: '项目内',
            public: '公共库',
          };
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                view === v
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]'
              }`}
            >
              {labels[v]}
            </button>
          );
        })}
        <div className="flex-1" />
      </div>

      {/* 四二收工:资产类别 chip 行(全部 / 人物 / 场景 / 道具 / 其他 / 未归类) */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className="text-[hsl(var(--color-muted-foreground))]">资产类别:</span>
        {(['', 'CHARACTER', 'SCENE', 'PROP', 'OTHER', 'VIDEO', 'UNCLASSIFIED'] as const).map((c) => {
          const labels: Record<CategoryFilter, string> = {
            '': '全部',
            CHARACTER: CATEGORY_LABEL.CHARACTER,
            SCENE: CATEGORY_LABEL.SCENE,
            PROP: CATEGORY_LABEL.PROP,
            OTHER: CATEGORY_LABEL.OTHER,
            VIDEO: CATEGORY_LABEL.VIDEO,
            UNCLASSIFIED: '未归类',
          };
          const active = categoryFilter === c;
          return (
            <button
              key={c || 'all'}
              onClick={() => setCategoryFilter(c)}
              className={`rounded-full border px-2.5 py-1 transition-colors ${
                active
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-muted))]'
              }`}
            >
              {labels[c]}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="relative max-w-xs">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--color-muted-foreground))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 filename / tag"
            className="w-48 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] py-1.5 pl-7 pr-2 text-xs"
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as MediaKind | '')}
          className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
        >
          <option value="">全部类型</option>
          <option value="IMAGE">图片</option>
          <option value="VIDEO">视频</option>
          <option value="AUDIO">音频</option>
          <option value="OTHER">其他</option>
        </select>
      </div>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">素材加载失败</div>
          <div className="mt-1 opacity-80">{error?.message}</div>
          <button onClick={() => refetch()} className="mt-2 rounded border border-red-500/50 px-2 py-1 text-xs hover:bg-red-500/20">
            重试
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-md border border-dashed border-[hsl(var(--color-border))] p-12 text-center">
          <FileIcon className="mx-auto size-10 text-[hsl(var(--color-muted-foreground))]" />
          <p className="mt-3 text-sm text-[hsl(var(--color-muted-foreground))]">
            {view === 'favorites'
              ? '还没有收藏的素材'
              : view === 'project'
                ? '项目还没有素材 — 点右上"上传"开始'
                : view === 'public'
                  ? '公共库暂无素材'
                  : '还没有素材 — 上传第一个,或在 AIGC 抽卡后自动沉淀'}
          </p>
          <button
            onClick={() => setUploadOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            <Upload className="size-3" />
            上传素材
          </button>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {data.items.map((m) => {
              const Icon = KIND_ICONS[m.kind as MediaKind] ?? FileIcon;
              return (
                <div
                  key={m.id}
                  className="group relative overflow-hidden rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]"
                >
                  {/* thumbnail */}
                  <div className="relative aspect-square bg-[hsl(var(--color-muted))]">
                    {m.kind === 'IMAGE' && m.previewUrl ? (
                      // 四二收工 P1:用后端 batch signed previewUrl(本地 dev cdnUrl 永远 null)
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.previewUrl}
                        alt={m.filename}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          // sign URL 过期/storage 出错时 fallback 占位
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : m.kind === 'VIDEO' && m.previewUrl ? (
                      // 需求2:视频可点击播放 — 缩略区显播放按钮,点击打开 dialog(列表不预加载视频省资源)
                      <button
                        type="button"
                        onClick={() => setVideoPreview({ url: m.previewUrl!, name: m.filename })}
                        className="group/v flex h-full w-full flex-col items-center justify-center text-[hsl(var(--color-muted-foreground))] transition-colors hover:bg-black/10"
                        title="点击播放视频"
                      >
                        <span className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover/v:scale-110">
                          <Play className="size-6 fill-current" />
                        </span>
                        <span className="mt-2 text-[10px] uppercase">VIDEO</span>
                      </button>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center text-[hsl(var(--color-muted-foreground))]">
                        <Icon className="size-10" />
                        <span className="mt-2 text-[10px] uppercase">{m.kind}</span>
                      </div>
                    )}
                    {/* AIGC 角标 + 资产类别 chip(四二收工) */}
                    <div className="absolute left-1.5 top-1.5 flex flex-col gap-1">
                      {m.source === 'AIGC' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/20 px-1 py-0.5 text-[9px] font-medium text-purple-700 dark:text-purple-400 backdrop-blur-sm">
                          <Sparkles className="size-2" />
                          AIGC
                        </span>
                      )}
                      {m.assetCategory && (
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm ${CATEGORY_CHIP_CLASS[m.assetCategory as AssetCategory]}`}
                        >
                          {CATEGORY_LABEL[m.assetCategory as AssetCategory] ?? m.assetCategory}
                        </span>
                      )}
                    </div>
                    {/* 操作浮层(hover 显示) */}
                    <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => toggleFavorite.mutate({ mediaId: m.id })}
                        className={`flex size-6 items-center justify-center rounded ${
                          m.isFavorited
                            ? 'bg-red-500 text-white'
                            : 'bg-black/50 text-white hover:bg-red-500'
                        }`}
                        title={m.isFavorited ? '取消收藏' : '收藏'}
                      >
                        <Heart className={`size-3 ${m.isFavorited ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ id: m.id, name: m.filename })}
                        className="flex size-6 items-center justify-center rounded bg-black/50 text-white hover:bg-red-500"
                        title="删除"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                    {/* 已收藏角标 */}
                    {m.isFavorited && (
                      <span className="absolute bottom-1.5 right-1.5 rounded-full bg-red-500 p-1 text-white">
                        <Heart className="size-2.5 fill-current" />
                      </span>
                    )}
                  </div>
                  {/* 信息 */}
                  <div className="p-2">
                    <div
                      className="truncate text-[11px] font-medium"
                      title={m.filename}
                    >
                      {m.filename}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      <span>{formatSize(m.sizeBytes)}</span>
                      <span>{m.scope}</span>
                    </div>
                    {/* 四二收工:类别快捷修改下拉 */}
                    <select
                      value={m.assetCategory ?? ''}
                      onChange={(e) => {
                        const v = e.target.value as AssetCategory | '';
                        setCategory.mutate({
                          mediaId: m.id,
                          assetCategory: v === '' ? null : v,
                        });
                      }}
                      disabled={setCategory.isPending}
                      className="mt-1 w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-1 py-0.5 text-[10px] disabled:opacity-50"
                      title="资产类别"
                    >
                      <option value="">未归类</option>
                      <option value="CHARACTER">人物</option>
                      <option value="SCENE">场景</option>
                      <option value="PROP">道具</option>
                      <option value="OTHER">其他</option>
                      <option value="VIDEO">视频</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 分页 */}
          <div className="mt-4 flex items-center justify-between text-xs">
            <div className="text-[hsl(var(--color-muted-foreground))]">
              共 {data.total} 个素材 · 第 {page} 页 / {Math.ceil(data.total / pageSize) || 1} 页
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="rounded border border-[hsl(var(--color-border))] px-3 py-1 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.hasMore}
                className="rounded border border-[hsl(var(--color-border))] px-3 py-1 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}

      {/* 上传 dialog */}
      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onSuccess={() => {
            void utils.media.list.invalidate();
            setUploadOpen(false);
          }}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title={`删除 "${deleteConfirm.name}"?`}
          description="软删除,可由管理员从回收站恢复(Phase 2)。AIGC 生成物删除不影响 GenerationAttempt 历史记录。"
          confirmLabel="确认删除"
          danger
          onConfirm={() => softDelete.mutate({ mediaId: deleteConfirm.id })}
          onClose={() => setDeleteConfirm(null)}
        />
      )}

      {/* 需求2:视频播放 dialog(点缩略图播放按钮打开) */}
      {videoPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setVideoPreview(null)}
        >
          <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={videoPreview.url}
              controls
              autoPlay
              className="max-h-[80vh] w-full rounded-lg bg-black"
            />
            <div className="mt-2 flex items-center justify-between text-xs text-white">
              <span className="truncate" title={videoPreview.name}>
                {videoPreview.name}
              </span>
              <button
                type="button"
                onClick={() => setVideoPreview(null)}
                className="ml-2 shrink-0 rounded border border-white/30 px-2 py-1 hover:bg-white/10"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 上传 dialog
// ---------------------------------------------------------------------------

function UploadDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}): React.ReactElement {
  const { data: projects } = trpc.project.list.useQuery();
  const [file, setFile] = React.useState<File | null>(null);
  const [scope, setScope] = React.useState<MediaScope>('PROJECT');
  const [projectId, setProjectId] = React.useState<string>('');
  const [tagsInput, setTagsInput] = React.useState('');
  // 四二收工:上传时即时归类(可空,后续可在卡片改)
  const [assetCategory, setAssetCategory] = React.useState<AssetCategory | ''>('');

  // 默认选第一个项目
  React.useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProjectId(projects[0]!.id);
    }
  }, [projects, projectId]);

  const upload = trpc.media.upload.useMutation({
    onSuccess: () => {
      toast.success(`已上传 ${file?.name}`);
      onSuccess();
    },
    onError: (e) => toast.error(`上传失败:${e.message}`),
  });

  const inferredKind = file ? inferKindFromFile(file) : null;

  const handleUpload = async (): Promise<void> => {
    if (!file || !inferredKind) return;
    if (scope === 'PROJECT' && !projectId) {
      toast.error('请选择项目');
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      upload.mutate({
        filename: file.name,
        fileBase64: base64,
        kind: inferredKind,
        scope,
        projectId: scope === 'PROJECT' ? projectId : undefined,
        mimeType: file.type || undefined,
        tags: tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        assetCategory: assetCategory || undefined,
      });
    } catch (err) {
      toast.error(`文件读取失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-[hsl(var(--color-card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-[hsl(var(--color-border))] px-5 py-3">
          <h3 className="text-sm font-semibold">上传素材</h3>
        </header>
        <div className="space-y-3 p-5">
          {/* 文件选择 */}
          <div>
            <label className="mb-1 block text-xs font-medium">选择文件</label>
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-blue-600 file:px-2 file:py-1 file:text-xs file:font-medium file:text-white"
            />
            {file && (
              <div className="mt-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                {formatSize(file.size)} · {file.type || 'unknown'} · 推断类型:
                {inferredKind === 'IMAGE'
                  ? '图片'
                  : inferredKind === 'VIDEO'
                    ? '视频'
                    : inferredKind === 'AUDIO'
                      ? '音频'
                      : '其他'}
              </div>
            )}
          </div>
          {/* scope */}
          <div>
            <label className="mb-1 block text-xs font-medium">归属</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as MediaScope)}
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
            >
              <option value="PROJECT">项目内</option>
              <option value="PUBLIC">公共库(所有人可见)</option>
            </select>
          </div>
          {scope === 'PROJECT' && (
            <div>
              <label className="mb-1 block text-xs font-medium">项目</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
              >
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {(!projects || projects.length === 0) && (
                  <option value="">无可用项目</option>
                )}
              </select>
            </div>
          )}
          {/* 四二收工:资产类别(可选) */}
          <div>
            <label className="mb-1 block text-xs font-medium">资产类别(可选)</label>
            <div className="flex gap-1">
              {([
                ['', '未归类'],
                ['CHARACTER', '人物'],
                ['SCENE', '场景'],
                ['PROP', '道具'],
                ['OTHER', '其他'],
                ['VIDEO', '视频'],
              ] as const).map(([v, label]) => {
                const active = assetCategory === v;
                return (
                  <button
                    key={v || 'none'}
                    type="button"
                    onClick={() => setAssetCategory(v as AssetCategory | '')}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] hover:bg-[hsl(var(--color-muted))]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">
              人物资产含人物形象、声音 · 场景资产含背景空间 · 道具资产含手持/陈设物品
            </p>
          </div>
          {/* tags */}
          <div>
            <label className="mb-1 block text-xs font-medium">
              标签(逗号分隔,可选)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="如:角色,主演,陆乘"
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
            />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-[hsl(var(--color-border))] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
          >
            取消
          </button>
          <button
            onClick={() => void handleUpload()}
            disabled={!file || upload.isPending || (scope === 'PROJECT' && !projectId)}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {upload.isPending && <Loader2 className="size-3 animate-spin" />}
            上传
          </button>
        </footer>
      </div>
    </div>
  );
}
