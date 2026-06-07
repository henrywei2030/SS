'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import {
  Loader2,
  Sparkles,
  Upload,
  FileText,
  ListChecks,
  Send,
  Download,
  Minus,
  Plus,
  ChevronDown,
  Package,
  Compass,
  Lightbulb,
  Link2,
  X,
  RotateCw,
  Combine,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { trpc } from '@/lib/trpc/client';

type ListShotsResult = inferRouterOutputs<AppRouter>['storyboard']['listShots'];
type PreviewResult = inferRouterOutputs<AppRouter>['script']['previewParseFile'];
// 需求3:分镜导出格式
type ExportFormat = 'csv' | 'txt' | 'word';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { fileToBase64 } from '@/lib/file-to-base64';

// 五六收工:加 'breakdown' tab
type TabKey = 'inspiration' | 'script' | 'breakdown' | 'shots';

interface Props {
  projectId: string;
  episodeId: string | undefined;
  episodeNumber: number | undefined;
  tab: TabKey;
  onTabChange: (t: TabKey) => void;
  fontSize: number;
  onFontSizeChange: (delta: 1 | -1) => void;
  onAfterAction: () => void;
}

export function TopBar({
  projectId,
  episodeId,
  episodeNumber,
  tab,
  onTabChange,
  fontSize,
  onFontSizeChange,
  onAfterAction,
}: Props): React.ReactElement {
  // 三十六收工 UX 改造:剧本分析按钮入口在剧本 tab(原"导演台首页"卡片入口已删)
  // P0 修:locale fallback 改 'zh-CN' 跟项目其他地方一致(原 'zh' 跟 next-intl 路由不匹配 → 404)
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'zh-CN';
  return (
    <div className="flex h-11 items-center justify-between border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3">
      {/* tab 切换 — 灵感创作在最左(想法→生成剧本的源头) */}
      <div className="flex items-center gap-1">
        <TabButton
          active={tab === 'inspiration'}
          onClick={() => onTabChange('inspiration')}
          icon={<Lightbulb className="size-3.5" />}
        >
          灵感创作
        </TabButton>
        <TabButton
          active={tab === 'script'}
          onClick={() => onTabChange('script')}
          icon={<FileText className="size-3.5" />}
        >
          剧本管理
        </TabButton>
        {/* 五六收工:剧本拆解 — 纯文字定稿(人物档案 / 关联),美术工坊负责生图 */}
        <TabButton
          active={tab === 'breakdown'}
          onClick={() => onTabChange('breakdown')}
          icon={<Users className="size-3.5" />}
        >
          剧本拆解
        </TabButton>
        <TabButton
          active={tab === 'shots'}
          onClick={() => onTabChange('shots')}
          icon={<ListChecks className="size-3.5" />}
        >
          分镜工坊
        </TabButton>
      </div>

      {/* 右侧按钮区 — tab 决定显示哪些按钮 */}
      <div className="flex items-center gap-2">
        {tab === 'shots' && episodeId && <ShotsProgress episodeId={episodeId} />}
        {tab === 'script' && (
          <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <Link href={`/${locale}/projects/${projectId}/director/analysis`}>
              <Compass className="size-3.5" />
              剧本分析
            </Link>
          </Button>
        )}
        {tab === 'script' ? (
          <ScriptActions
            projectId={projectId}
            currentEpisodeNumber={episodeNumber}
            onSaved={onAfterAction}
          />
        ) : tab === 'shots' ? (
          <ShotsActions
            projectId={projectId}
            episodeId={episodeId}
            episodeNumber={episodeNumber}
            onAfterAction={onAfterAction}
          />
        ) : null}
        {tab === 'shots' && (
          <FontSizeControl fontSize={fontSize} onChange={onFontSizeChange} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors',
        active
          ? 'bg-[hsl(var(--color-accent)/0.12)] font-medium text-[hsl(var(--color-accent))] shadow-sm'
          : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 剧本 tab 操作
// ---------------------------------------------------------------------------

// 关联剧本 — 把"灵感创作"生成的某集剧本上传为本集正式剧本(source=AI_GENERATED)
function LinkInspirationButton({
  projectId,
  onSaved,
}: {
  projectId: string;
  // 全盘审查 #14:删死 prop episodeNumber — 改多集导入后组件全靠 selectedNums,此 prop 从未被解构使用
  onSaved: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [draftId, setDraftId] = React.useState('');
  const [selectedNums, setSelectedNums] = React.useState<Set<number>>(new Set());
  const utils = trpc.useUtils();

  // 需求1e:只列顶置草稿(用户标记最满意的才能关联到剧本)
  const { data: drafts } = trpc.inspiration.listDrafts.useQuery(
    { projectId, pinnedOnly: true },
    { enabled: open },
  );
  const { data: draft } = trpc.inspiration.getDraft.useQuery(
    { draftId },
    { enabled: open && !!draftId },
  );

  const episodes = (
    (draft?.episodes as unknown as { number: number; title: string; content: string }[]) ?? []
  ).filter((e) => e.content);

  // 四九收工:草稿加载后默认全选所有已展开集(默认全部导入)
  React.useEffect(() => {
    if (draft) setSelectedNums(new Set(episodes.map((e) => e.number)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draft]);

  const link = trpc.script.linkInspirationEpisodes.useMutation({
    onSuccess: (res) => {
      // 报"已关联集数"= total - skipped(含新建 + 内容未变已是最新的,都算关联成功)
      const linked = res.total - res.skipped;
      toast.success(
        `已关联 ${linked} 集剧本${res.created < linked ? `(${res.created} 集更新版本 · 其余已是最新)` : ''}${
          res.skipped > 0 ? ` · ${res.skipped} 集生成中跳过` : ''
        }`,
      );
      setOpen(false);
      void utils.script.listVersions.invalidate();
      void utils.storyboard.listEpisodes.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle = (n: number): void =>
    setSelectedNums((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const allSelected = episodes.length > 0 && selectedNums.size === episodes.length;
  const toggleAll = (): void =>
    setSelectedNums(allSelected ? new Set() : new Set(episodes.map((e) => e.number)));

  const confirm = (): void => {
    if (selectedNums.size === 0) {
      toast.error('请至少选一集');
      return;
    }
    link.mutate({ draftId, episodeNumbers: [...selectedNums] });
  };

  const inputCls =
    'w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs';

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-xs"
        onClick={() => setOpen(true)}
        title="把灵感创作生成的剧本导入为正式剧本(默认全部集,灵感第N集→本项目第N集)"
      >
        <Link2 className="size-3.5" />
        关联剧本
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>关联灵感剧本</DialogTitle>
            <DialogDescription>
              把「灵感创作」生成的剧本导入为剧本子模块的正式版本(source=AI_GENERATED)。
              默认全部集,灵感第 N 集 → 本项目第 N 集,效果跟上传剧本一致。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block text-xs font-medium">选灵感草稿</label>
              <select
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                className={inputCls}
              >
                <option value="">— 选择草稿 —</option>
                {drafts?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              {drafts && drafts.length === 0 && (
                <p className="mt-1 text-[11px] text-[hsl(var(--color-muted-foreground))]">
                  还没有顶置的灵感草稿 — 去「灵感创作」tab 生成后点 📌 顶置最满意的剧本
                </p>
              )}
            </div>
            {draftId && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium">
                    选择导入的集(默认全部 · 已选 {selectedNums.size}/{episodes.length})
                  </label>
                  {episodes.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-[11px] text-[hsl(var(--color-accent))] hover:underline"
                    >
                      {allSelected ? '全不选' : '全选'}
                    </button>
                  )}
                </div>
                {episodes.length === 0 ? (
                  <p className="text-[11px] text-[hsl(var(--color-muted-foreground))]">
                    该草稿还没有已展开的集 — 去「灵感创作」展开本集 / 全部展开后再关联
                  </p>
                ) : (
                  <div className="max-h-56 space-y-0.5 overflow-auto rounded border border-[hsl(var(--color-border))] p-1">
                    {episodes.map((e) => (
                      <label
                        key={e.number}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-[hsl(var(--color-muted))]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedNums.has(e.number)}
                          onChange={() => toggle(e.number)}
                          className="size-3.5"
                        />
                        <span className="truncate">
                          第{e.number}集 · {e.title}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={confirm} disabled={selectedNums.size === 0 || link.isPending}>
              {link.isPending && <Loader2 className="size-3.5 animate-spin" />}
              关联 {selectedNums.size} 集剧本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScriptActions({
  projectId,
  currentEpisodeNumber,
  onSaved,
}: {
  projectId: string;
  currentEpisodeNumber: number | undefined;
  onSaved: () => void;
}): React.ReactElement {
  const fileRef = React.useRef<HTMLInputElement>(null);
  // 默认跟随左栏选中集，用户也可手动改成 N+1 上传新集
  const [episodeNumber, setEpisodeNumber] = React.useState<number>(currentEpisodeNumber ?? 1);
  const [pendingFile, setPendingFile] = React.useState<{ base64: string; filename: string } | null>(
    null,
  );
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);

  // 选中集变化时同步集号(避免误传到错集)
  React.useEffect(() => {
    if (currentEpisodeNumber !== undefined) {
      setEpisodeNumber(currentEpisodeNumber);
    }
  }, [currentEpisodeNumber]);

  const utilsScript = trpc.useUtils();
  const previewParse = trpc.script.previewParseFile.useMutation({
    onSuccess: (res, vars) => {
      setPendingFile({ base64: vars.fileBase64, filename: vars.filename });
      setPreview(res);
    },
    onError: (e) => toast.error(`预览解析失败: ${e.message}`),
  });

  const uploadFile = trpc.script.uploadFile.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.created
          ? `第 ${res.episode.number} 集 V${res.script.version} 上传成功（${res.format} · ${res.parsedSceneCount} 场）`
          : '内容未变化，未创建新版本',
      );
      setPendingFile(null);
      setPreview(null);
      void utilsScript.script.listVersions.invalidate();
      void utilsScript.storyboard.listEpisodes.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadMulti = trpc.script.uploadMultiEpisode.useMutation({
    onSuccess: (res) => {
      const created = res.episodes.filter((e) => e.created).length;
      // 需求2B:锁定集被跳过(保留原内容),提示用户
      const skippedLocked = res.episodes.filter((e) => e.skippedLocked).length;
      const unchanged = res.episodeCount - created - skippedLocked;
      toast.success(
        `多集上传完成:${res.episodeCount} 集解析 · ${created} 集更新${
          skippedLocked > 0 ? ` · ${skippedLocked} 集锁定保留` : ''
        }${unchanged > 0 ? ` · ${unchanged} 集内容未变化` : ''}`,
      );
      setPendingFile(null);
      setPreview(null);
      // 刷新所有受影响的集的 listVersions cache(防 ScriptPane 显示空白)
      void utilsScript.script.listVersions.invalidate();
      void utilsScript.storyboard.listEpisodes.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重选同一文件
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      previewParse.mutate({ projectId, filename: file.name, fileBase64: base64 });
    } catch (err) {
      toast.error(`文件读取失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const confirmUpload = (): void => {
    if (!pendingFile || !preview) return;
    if (preview.multiEpisode) {
      uploadMulti.mutate({
        projectId,
        filename: pendingFile.filename,
        fileBase64: pendingFile.base64,
      });
    } else {
      // 单集 — 用户指定集号
      uploadFile.mutate({
        projectId,
        episodeNumber,
        filename: pendingFile.filename,
        fileBase64: pendingFile.base64,
        title: pendingFile.filename.replace(/\.[a-z0-9]+$/i, ''),
      });
    }
  };

  const cancelUpload = (): void => {
    setPendingFile(null);
    setPreview(null);
  };

  const submitting = uploadFile.isPending || uploadMulti.isPending;
  const loading = previewParse.isPending || submitting;

  return (
    <>
      <input
        type="number"
        min={1}
        value={episodeNumber}
        onChange={(e) => setEpisodeNumber(Number(e.target.value))}
        className="h-7 w-14 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-sm"
        title="集号(单集上传用 · 多集 docx 由 parser 自动切)"
      />
      <input
        ref={fileRef}
        type="file"
        accept=".docx,.txt,.md,.markdown,.rtf,.html,.htm"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        size="sm"
        variant="default"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className="gap-1.5"
        title="支持 docx / txt / md / rtf / html · 含「第N集」标题自动切多集"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Upload className="size-3.5" />
        )}
        上传剧本
      </Button>

      <LinkInspirationButton
        projectId={projectId}
        onSaved={onSaved}
      />

      <Dialog open={preview !== null} onOpenChange={(o) => !o && cancelUpload()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {preview?.multiEpisode
                ? `检测到 ${preview.episodes.length} 集,确认导入?`
                : '单集上传,确认?'}
            </DialogTitle>
            <DialogDescription>
              {preview?.multiEpisode
                ? '按「第N集」标题自动切分到各集。已存在的集号会新增版本。'
                : `未识别到「第N集」标题,作为单集上传到第 ${episodeNumber} 集。`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {preview?.episodes.map((ep) => (
              <div
                key={ep.episodeNumber}
                className="rounded border border-[hsl(var(--color-border))] p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">第 {ep.episodeNumber} 集</span>
                  <span className="font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                    {ep.contentLength.toLocaleString()} 字 · {ep.sceneCount} 场
                  </span>
                </div>
                {ep.title && (
                  <div className="mt-0.5 text-[12px] text-[hsl(var(--color-muted-foreground))]">
                    {ep.title}
                  </div>
                )}
                <div className="mt-1 line-clamp-2 text-[11px] text-[hsl(var(--color-muted-foreground))]">
                  {ep.preview}…
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={cancelUpload} disabled={submitting}>
              取消
            </Button>
            <Button size="sm" onClick={confirmUpload} disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              确认上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// 分镜 tab 操作
// ---------------------------------------------------------------------------

function ShotsActions({
  projectId,
  episodeId,
  episodeNumber,
  onAfterAction,
}: {
  projectId: string;
  episodeId: string | undefined;
  episodeNumber: number | undefined;
  onAfterAction: () => void;
}): React.ReactElement {
  const utils = trpc.useUtils();

  // 全集生成进度状态(四九收工:3 并发 + 可中断 + 每集状态)
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchRunning, setBatchRunning] = React.useState(false);
  const cancelRef = React.useRef(false);
  type EpStat = {
    episodeNumber: number;
    episodeId: string;
    title?: string | null;
    status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
    error?: string;
  };
  const [batchEps, setBatchEps] = React.useState<EpStat[]>([]);
  const batchStarted = batchEps.length > 0;
  const doneCount = batchEps.filter((e) => e.status === 'done').length;
  const failedEps = batchEps.filter((e) => e.status === 'failed');

  const eligibleQuery = trpc.storyboard.listEligibleForGeneration.useQuery(
    { projectId },
    { enabled: batchOpen },
  );

  const generate = trpc.storyboard.generateForEpisode.useMutation({
    onSuccess: (res, vars) => {
      const msg = `生成完成:${res.shotCount} 镜 / ${res.groupCount} 组`;
      if (res.shotCount === 0) {
        toast.error(
          res.errors.length > 0
            ? `生成失败:${res.errors[0]}`
            : '生成 0 镜 — 剧本可能为空或 LLM 返回格式异常,看后台日志',
          { duration: 8000 },
        );
      } else if (res.errors.length > 0) {
        toast.warning(`${msg}(${res.errors.length} 场有警告)`);
      } else {
        toast.success(msg);
      }
      // 刷新右侧分镜内容 + 左栏集数统计
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: true });
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: false });
      void utils.storyboard.listEpisodes.invalidate();
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  // 全盘审查 #4:批量池专用「静默」mutation — 不弹单集 toast、不每集 invalidate listEpisodes。
  //   runPool 自己维护每集 chip 状态 + 结束后统一 onAfterAction()。原来池复用上面的 generate,
  //   React-Query 对每次 mutateAsync 都触发其 hook 级 onSuccess/onError → N 集弹 N 个 toast + N 次 refetch 刷屏。
  const generateSilent = trpc.storyboard.generateForEpisode.useMutation();

  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'zh-CN';

  const publish = trpc.storyboard.publishEpisode.useMutation({
    onSuccess: (res) => {
      // 用户反馈 r3:确认发布后 AIGC 模块要看到最新分镜 + prompt
      // AIGC 直接 query 活表,只需让 react-query cache 失效
      void utils.aigc.listGroups.invalidate({ episodeId: res.episodeId });
      void utils.aigc.getGroupDetail.invalidate();
      // 三十七收工:publishEpisode 现在自动为 standalone shot 建 1:1 ShotGroup
      //   shotCount > 0 即视为有 AIGC 可同步(原 aigcReady = groupCount > 0 过严)
      const aigcSyncable = res.shotCount > 0;
      toast.success(
        aigcSyncable
          ? `已发布 v${res.version} · ${res.shotCount} 镜 / ${res.groupCount} 组 · 已同步到 AIGC`
          : `已发布 v${res.version}(本集 0 镜,暂无内容同步到 AIGC)`,
        aigcSyncable
          ? {
              duration: 6000,
              action: {
                label: '前往 AIGC',
                onClick: () =>
                  router.push(`/${locale}/projects/${res.projectId}/aigc/${res.episodeId}`),
              },
            }
          : undefined,
      );
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  // 自动整合(2026-06):对当前集未入组的单一分镜按顺序贪心合并成组(每组累计 ≤maxDurationS)
  const autoMerge = trpc.storyboard.autoMergeEpisode.useMutation({
    onSuccess: (res, vars) => {
      if (res.groupsCreated > 0) toast.success(res.message);
      else toast.warning(res.message);
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: true });
      void utils.storyboard.listShots.invalidate({ episodeId: vars.episodeId, grouped: false });
      onAfterAction();
    },
    onError: (e) => toast.error(`自动整合失败:${e.message}`),
  });

  const handleExportCurrent = async (format: ExportFormat): Promise<void> => {
    if (!episodeId) return;
    try {
      const data = await utils.storyboard.listShots.fetch({ episodeId, grouped: true });
      const epn = episodeNumber ?? 0;
      if (format === 'csv') {
        downloadFile(buildShotsCsv(data, epn), `第${epn}集分镜.csv`, 'text/csv;charset=utf-8;');
      } else if (format === 'txt') {
        downloadFile(buildShotsText(data, epn), `第${epn}集分镜.txt`, 'text/plain;charset=utf-8;');
      } else {
        downloadFile(
          wrapWordHtml(`第${epn}集分镜`, buildShotsHtml(data, epn)),
          `第${epn}集分镜.doc`,
          'application/msword',
        );
      }
      toast.success(`${format.toUpperCase()} 导出完成`);
    } catch (e) {
      toast.error(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExportAll = async (format: ExportFormat): Promise<void> => {
    try {
      const data = await utils.storyboard.listShotsByProject.fetch({ projectId });
      const nonEmpty = data.episodes.filter((ep) => ep.shotCount > 0);
      if (nonEmpty.length === 0) {
        toast.warning('项目内还没有任何已生成的分镜');
        return;
      }
      if (format === 'csv') {
        const headerRow = buildShotsCsv({ groups: [], ungrouped: [] }, 0).split('\n')[0] ?? '';
        const bodies: string[] = [];
        for (const ep of nonEmpty) {
          const full = buildShotsCsv({ groups: ep.groups, ungrouped: ep.ungrouped }, ep.episodeNumber);
          const lines = full.split('\n');
          if (lines.length > 1) bodies.push(lines.slice(1).join('\n'));
        }
        downloadFile(
          [headerRow, ...bodies].filter(Boolean).join('\n'),
          `项目全部分镜(${nonEmpty.length}集).csv`,
          'text/csv;charset=utf-8;',
        );
      } else if (format === 'txt') {
        const txt = nonEmpty
          .map((ep) => buildShotsText({ groups: ep.groups, ungrouped: ep.ungrouped }, ep.episodeNumber))
          .join('\n\n\n');
        downloadFile(txt, `项目全部分镜(${nonEmpty.length}集).txt`, 'text/plain;charset=utf-8;');
      } else {
        const bodies = nonEmpty
          .map((ep) => buildShotsHtml({ groups: ep.groups, ungrouped: ep.ungrouped }, ep.episodeNumber))
          .join('<br/><br/>');
        downloadFile(
          wrapWordHtml('项目全部分镜', bodies),
          `项目全部分镜(${nonEmpty.length}集).doc`,
          'application/msword',
        );
      }
      toast.success(`已导出 ${nonEmpty.length} 集分镜`);
    } catch (e) {
      toast.error(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const disabled = !episodeId;

  const BATCH_CONCURRENCY = 3;

  const setEpStat = (episodeId: string, status: EpStat['status'], error?: string): void =>
    setBatchEps((prev) =>
      prev.map((e) => (e.episodeId === episodeId ? { ...e, status, error } : e)),
    );

  // 四九收工:3 并发 worker pool — 跑指定集列表(全量生成 / 失败重试 复用),每 worker 抢下一个
  const runPool = async (targets: { episodeId: string }[]): Promise<void> => {
    if (targets.length === 0) return;
    cancelRef.current = false;
    setBatchRunning(true);
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (cancelRef.current) return;
        const myIdx = idx++;
        if (myIdx >= targets.length) return;
        const ep = targets[myIdx];
        if (!ep) continue;
        setEpStat(ep.episodeId, 'running');
        try {
          await generateSilent.mutateAsync({ episodeId: ep.episodeId, replaceExisting: true });
          // 全盘审查 #3:mutateAsync 已 resolve = 后端已落库,无条件标 done。
          //   原 `cancelRef ? 'cancelled' : 'done'` 会把"取消时正好已成功落库"的集误标 cancelled,
          //   与 cancelBatch 注释"in-flight 跑完即停(后端已落库)"矛盾,且让用户误以为没生成。
          setEpStat(ep.episodeId, 'done');
        } catch (e) {
          setEpStat(ep.episodeId, 'failed', e instanceof Error ? e.message : String(e));
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, targets.length) }, () => worker()),
    );
    // 取消后:还没跑的 pending 标 cancelled
    if (cancelRef.current) {
      setBatchEps((prev) =>
        prev.map((e) => (e.status === 'pending' ? { ...e, status: 'cancelled' } : e)),
      );
    }
    setBatchRunning(false);
    onAfterAction();
  };

  const runBatch = async (): Promise<void> => {
    const eligible = eligibleQuery.data ?? [];
    if (eligible.length === 0) return;
    setBatchEps(
      eligible.map((e) => ({
        episodeNumber: e.episodeNumber,
        episodeId: e.episodeId,
        title: e.title,
        status: 'pending' as const,
      })),
    );
    await runPool(eligible);
  };

  // 失败集就地重试:把 failed 重置 pending 再跑(已成功/中断的集不动),复用同款 3 并发 pool
  const retryFailed = async (): Promise<void> => {
    const targets = batchEps.filter((e) => e.status === 'failed');
    if (targets.length === 0) return;
    setBatchEps((prev) =>
      prev.map((e) =>
        e.status === 'failed' ? { ...e, status: 'pending' as const, error: undefined } : e,
      ),
    );
    await runPool(targets);
  };

  const cancelBatch = (): void => {
    cancelRef.current = true; // 不再启动新集;in-flight 的集跑完即停(后端已落库)
  };

  const resetBatch = (): void => {
    setBatchEps([]);
    setBatchOpen(false);
  };

  return (
    <>
      {/* 生成分镜 — 仅当前集 */}
      <Button
        size="sm"
        variant="default"
        onClick={() => episodeId && generate.mutate({ episodeId, replaceExisting: true })}
        disabled={disabled || generate.isPending || batchRunning}
        className="gap-1.5"
        title={episodeNumber ? `为第 ${episodeNumber} 集生成分镜` : '请先选集'}
      >
        {generate.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        生成分镜
      </Button>

      {/* 全部集数生成 — 独立按钮,打开列表 modal */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setBatchOpen(true)}
        disabled={generate.isPending || batchRunning}
        className="gap-1.5"
        title="批量生成所有未锁定 + 有剧本的集"
      >
        {batchRunning ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Package className="size-3.5" />
        )}
        全部集数生成
      </Button>

      <Dialog
        open={batchOpen}
        onOpenChange={(o) => {
          if (!o && batchRunning) return; // running 中点遮罩不关(用"中断生成"按钮)
          if (!o) resetBatch();
          else setBatchOpen(o);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {batchRunning
                ? `分镜生成中 · ${doneCount + failedEps.length}/${batchEps.length}`
                : batchStarted
                  ? '生成结果'
                  : '为全部集生成分镜(3 集并发)'}
            </DialogTitle>
            <DialogDescription>
              {batchRunning
                ? `3 集并发 · 已完成 ${doneCount} · 失败 ${failedEps.length} · 进行中 ${batchEps.filter((e) => e.status === 'running').length}`
                : batchStarted
                  ? `成功 ${doneCount} 集 · 失败 ${failedEps.length} 集${batchEps.some((e) => e.status === 'cancelled') ? ` · 中断 ${batchEps.filter((e) => e.status === 'cancelled').length} 集` : ''}`
                  : '只列"有剧本 + 未锁"的集 · 3 集同时生成 · 失败/中断的集互不影响,可再次生成补齐'}
            </DialogDescription>
          </DialogHeader>

          {/* 未开始:可生成集列表 */}
          {!batchStarted && (
            <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {eligibleQuery.isLoading ? (
                <div className="flex items-center gap-2 text-[hsl(var(--color-muted-foreground))]">
                  <Loader2 className="size-3.5 animate-spin" /> 加载…
                </div>
              ) : (eligibleQuery.data ?? []).length === 0 ? (
                <div className="text-[hsl(var(--color-muted-foreground))]">
                  没有可生成的集(每集需有当前剧本 + 不在生成锁中)
                </div>
              ) : (
                (eligibleQuery.data ?? []).map((e) => (
                  <div
                    key={e.episodeId}
                    className="flex items-center justify-between rounded border border-[hsl(var(--color-border))] px-2 py-1"
                  >
                    <span>
                      第 {e.episodeNumber} 集{e.title ? ` · ${e.title}` : ''}
                    </span>
                    <span className="font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      v{e.scriptVersion}
                      {e.existingShotCount > 0 ? ` · 已有 ${e.existingShotCount} 镜` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 已开始:B站式进度 — 进度条 + 流光动画 + 每集状态 chip */}
          {batchStarted && (
            <div className="space-y-3">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--color-muted))]">
                <div
                  className="h-full rounded-full bg-[hsl(var(--color-success))] transition-all duration-500"
                  style={{
                    width: `${batchEps.length > 0 ? Math.round(((doneCount + failedEps.length) / batchEps.length) * 100) : 0}%`,
                  }}
                />
                {batchRunning && (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-[hsl(var(--color-foreground))]/10 to-transparent" />
                )}
              </div>
              {batchRunning && (
                <div className="flex items-center justify-center gap-2 py-1 text-xs text-[hsl(var(--color-muted-foreground))]">
                  <Loader2 className="size-4 animate-spin text-[hsl(var(--color-primary))]" />
                  <span>3 集并发生成中,请稍候…</span>
                </div>
              )}
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {batchEps.map((e) => {
                  const cls =
                    e.status === 'done'
                      ? 'border-[hsl(var(--color-success))]/40 bg-[hsl(var(--color-success))]/10 text-[hsl(var(--color-success))]'
                      : e.status === 'failed'
                        ? 'border-[hsl(var(--color-destructive))]/40 bg-[hsl(var(--color-destructive))]/10 text-[hsl(var(--color-destructive))]'
                        : e.status === 'running'
                          ? 'border-[hsl(var(--color-primary))]/50 bg-[hsl(var(--color-primary))]/10 text-[hsl(var(--color-primary))]'
                          : e.status === 'cancelled'
                            ? 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))] line-through'
                            : 'border-[hsl(var(--color-border))] text-[hsl(var(--color-muted-foreground))]';
                  return (
                    <span
                      key={e.episodeId}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${cls}`}
                      title={e.error ?? e.title ?? ''}
                    >
                      {e.status === 'running' ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : e.status === 'done' ? (
                        '✓'
                      ) : e.status === 'failed' ? (
                        '✗'
                      ) : e.status === 'cancelled' ? (
                        '⊘'
                      ) : (
                        '○'
                      )}
                      第{e.episodeNumber}集
                    </span>
                  );
                })}
              </div>
              {failedEps.length > 0 && !batchRunning && (
                <div className="max-h-24 space-y-0.5 overflow-y-auto rounded-md border border-[hsl(var(--color-destructive))]/30 bg-[hsl(var(--color-destructive))]/5 p-2 text-[11px]">
                  {failedEps.map((f) => (
                    <div key={f.episodeId} className="text-[hsl(var(--color-destructive))]">
                      第 {f.episodeNumber} 集:{f.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {batchRunning ? (
              <Button variant="outline" size="sm" onClick={cancelBatch} className="text-red-600">
                <X className="size-3.5" />
                中断生成(进行中的集跑完即停)
              </Button>
            ) : batchStarted ? (
              <>
                {failedEps.length > 0 && (
                  <Button variant="default" size="sm" onClick={retryFailed} className="gap-1.5">
                    <RotateCw className="size-3.5" />
                    重新生成失败的 {failedEps.length} 集
                  </Button>
                )}
                <Button
                  variant={failedEps.length > 0 ? 'outline' : 'default'}
                  size="sm"
                  onClick={resetBatch}
                >
                  关闭
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setBatchOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={runBatch}
                  disabled={(eligibleQuery.data ?? []).length === 0 || eligibleQuery.isLoading}
                >
                  <Sparkles className="size-3.5" />
                  开始生成({(eligibleQuery.data ?? []).length} 集 · 3 并发)
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Download className="size-3.5" />
            导出
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => void handleExportCurrent('word')} disabled={disabled}>
            <FileText className="mr-2 size-3.5" />
            当前集 · Word
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportCurrent('txt')} disabled={disabled}>
            <FileText className="mr-2 size-3.5" />
            当前集 · TXT
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportCurrent('csv')} disabled={disabled}>
            <FileText className="mr-2 size-3.5" />
            当前集 · CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportAll('word')}>
            <Package className="mr-2 size-3.5" />
            全部集 · Word
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportAll('txt')}>
            <Package className="mr-2 size-3.5" />
            全部集 · TXT
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleExportAll('csv')}>
            <Package className="mr-2 size-3.5" />
            全部集 · CSV(合并)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="outline"
        onClick={() => episodeId && autoMerge.mutate({ episodeId })}
        disabled={disabled || autoMerge.isPending || publish.isPending}
        className="gap-1.5"
        title="把当前集未入组的单一分镜按顺序贪心合并成分镜组(每组累计 ≤15s,严格按顺序、不任意组合)"
      >
        {autoMerge.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Combine className="size-3.5" />
        )}
        自动整合
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => episodeId && publish.mutate({ episodeId })}
        disabled={disabled || publish.isPending}
        className="gap-1.5"
      >
        {publish.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
        确认发布
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// 进度 / 字号 / CSV 导出辅助
// ---------------------------------------------------------------------------

function ShotsProgress({ episodeId }: { episodeId: string }): React.ReactElement {
  const { data } = trpc.storyboard.listShots.useQuery({ episodeId, grouped: false });
  const shots = (data && 'shots' in data ? data.shots : undefined) ?? [];
  const total = shots.length;
  const published = shots.filter((s) => s.status !== 'DRAFT').length;
  if (total === 0) return <></>;
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      {published}/{total} 镜
    </Badge>
  );
}

function FontSizeControl({
  fontSize,
  onChange,
}: {
  fontSize: number;
  onChange: (delta: 1 | -1) => void;
}): React.ReactElement {
  return (
    <div className="ml-1 flex items-center gap-0.5 rounded border border-[hsl(var(--color-border))] px-0.5">
      <button
        onClick={() => onChange(-1)}
        className="flex size-6 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
        title="缩小字号"
      >
        <Minus className="size-3" />
      </button>
      <span className="w-6 text-center font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
        {fontSize}
      </span>
      <button
        onClick={() => onChange(1)}
        className="flex size-6 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
        title="放大字号"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

function buildShotsCsv(data: ListShotsResult, episodeNumber: number): string {
  const groups = (data && 'groups' in data ? data.groups : undefined) ?? [];
  const ungrouped = (data && 'ungrouped' in data ? data.ungrouped : undefined) ?? [];

  // 层级列让 Excel 浏览者一眼分辨"组级合并 prompt"和"组内单镜数据"。
  // 组级 prompt = 该组送给视频模型的最终 prompt(单镜 prompt 在编辑时也存了一份原始版,导出时一并暴露便于训练审计)
  const headers = [
    '集',
    '层级',
    '组号',
    '组内序',
    '单镜号',
    '景别',
    '角度',
    '时长(s)',
    '优先级',
    '剧本内容',
    '提示词(含台词/OS)',
    '状态',
  ];

  const rows: string[][] = [];
  for (const g of groups) {
    // 先输出组级合并 prompt(导出主行,送给视频模型用的就是这条)
    rows.push([
      String(episodeNumber),
      '组级',
      g.number,
      '—',
      '—',
      '—',
      '—',
      g.durationS.toFixed(1),
      '—',
      '—',
      g.prompt,
      g.status,
    ]);
    // 再输出组内每个单镜的细节(训练审计用)
    g.shots.forEach((s, i) => {
      rows.push([
        String(episodeNumber),
        '子镜',
        g.number,
        `${i + 1}/${g.shots.length}`,
        s.number,
        s.framing ?? '',
        s.angle ?? '',
        s.durationS.toFixed(1),
        s.priority ?? '',
        s.content,
        s.prompt,
        s.status,
      ]);
    });
  }
  // 未分组单镜独立列出(无"组"概念)
  for (const s of ungrouped) {
    rows.push([
      String(episodeNumber),
      '单镜',
      '(未分组)',
      '—',
      s.number,
      s.framing ?? '',
      s.angle ?? '',
      s.durationS.toFixed(1),
      s.priority ?? '',
      s.content,
      s.prompt,
      s.status,
    ]);
  }

  return [headers, ...rows].map(csvRow).join('\n');
}

function csvRow(cells: string[]): string {
  return cells
    .map((c) => {
      const needsQuote = /[",\n]/.test(c);
      const escaped = c.replace(/"/g, '""');
      return needsQuote ? `"${escaped}"` : escaped;
    })
    .join(',');
}

// 需求3:TXT 导出 — 可读纯文本结构(组 → 组级 prompt → 各单镜)
function buildShotsText(data: ListShotsResult, episodeNumber: number): string {
  const groups = (data && 'groups' in data ? data.groups : undefined) ?? [];
  const ungrouped = (data && 'ungrouped' in data ? data.ungrouped : undefined) ?? [];
  const lines: string[] = [`第${episodeNumber}集 分镜表`, '='.repeat(28), ''];
  const shotLines = (
    s: { number: string; framing?: string | null; angle?: string | null; durationS: number; priority?: string | null; content: string; prompt: string },
  ): void => {
    lines.push(`  · 镜${s.number} [${s.framing ?? ''}/${s.angle ?? ''}] ${s.durationS.toFixed(1)}s ${s.priority ?? ''}`);
    lines.push(`    剧本: ${s.content}`);
    lines.push(`    提示词: ${s.prompt}`);
  };
  for (const g of groups) {
    lines.push(`【组 ${g.number}】 时长 ${g.durationS.toFixed(1)}s · 状态 ${g.status}`);
    lines.push(`组级提示词: ${g.prompt}`);
    g.shots.forEach(shotLines);
    lines.push('');
  }
  if (ungrouped.length > 0) {
    lines.push('【未分组单镜】');
    ungrouped.forEach(shotLines);
  }
  return lines.join('\n');
}

// 需求3:Word 导出 — HTML 表格(Word 可直接打开 .doc),含组级 prompt + 单镜明细
function buildShotsHtml(data: ListShotsResult, episodeNumber: number): string {
  const groups = (data && 'groups' in data ? data.groups : undefined) ?? [];
  const ungrouped = (data && 'ungrouped' in data ? data.ungrouped : undefined) ?? [];
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
  const td = (...cells: string[]): string =>
    `<tr>${cells
      .map((c) => `<td style="border:1px solid #999;padding:4px;font-size:11px;vertical-align:top">${esc(c)}</td>`)
      .join('')}</tr>`;
  const rows: string[] = [];
  for (const g of groups) {
    rows.push(td(`组 ${g.number}`, '组级', '—', g.durationS.toFixed(1), '—', g.prompt, g.status));
    g.shots.forEach((s, i) =>
      rows.push(
        td(`${g.number}-${i + 1}`, `${s.framing ?? ''}/${s.angle ?? ''}`, s.number, s.durationS.toFixed(1), s.priority ?? '', `${s.content}\n${s.prompt}`, s.status),
      ),
    );
  }
  for (const s of ungrouped) {
    rows.push(
      td('单镜', `${s.framing ?? ''}/${s.angle ?? ''}`, s.number, s.durationS.toFixed(1), s.priority ?? '', `${s.content}\n${s.prompt}`, s.status),
    );
  }
  const headers = ['组/镜', '景别/角度', '镜号', '时长(s)', '优先级', '内容/提示词', '状态']
    .map((h) => `<th style="border:1px solid #999;padding:4px;background:#eee">${h}</th>`)
    .join('');
  return `<h2>第${episodeNumber}集 分镜表</h2><table style="border-collapse:collapse;width:100%"><tr>${headers}</tr>${rows.join('')}</table>`;
}

function wrapWordHtml(title: string, body: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function downloadFile(content: string, filename: string, mime: string): void {
  // BOM 让 Excel 正确识别 UTF-8
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
