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
} from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { trpc } from '@/lib/trpc/client';

type ListShotsResult = inferRouterOutputs<AppRouter>['storyboard']['listShots'];
type PreviewResult = inferRouterOutputs<AppRouter>['script']['previewParseFile'];
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

interface Props {
  projectId: string;
  episodeId: string | undefined;
  episodeNumber: number | undefined;
  tab: 'script' | 'shots';
  onTabChange: (t: 'script' | 'shots') => void;
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
      {/* tab 切换 */}
      <div className="flex items-center gap-1">
        <TabButton
          active={tab === 'script'}
          onClick={() => onTabChange('script')}
          icon={<FileText className="size-3.5" />}
        >
          剧本
        </TabButton>
        <TabButton
          active={tab === 'shots'}
          onClick={() => onTabChange('shots')}
          icon={<ListChecks className="size-3.5" />}
        >
          分镜
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
        ) : (
          <ShotsActions
            projectId={projectId}
            episodeId={episodeId}
            episodeNumber={episodeNumber}
            onAfterAction={onAfterAction}
          />
        )}
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
        'flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px]',
        active
          ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
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
      const unchanged = res.episodeCount - created;
      toast.success(
        `多集上传完成:${res.episodeCount} 集解析 · ${created} 集新版本${
          unchanged > 0 ? ` · ${unchanged} 集内容未变化` : ''
        }`,
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

/**
 * 用浏览器原生 FileReader 把文件编为 base64
 *
 * 比手写 `String.fromCharCode(...subarray)` 分块 + btoa 更安全：
 *   - 不在 JS 堆里分配中间 binary string（避免 15MB 文件 → 80MB 临时峰值）
 *   - 不受 V8 spread 栈大小限制
 *   - 大文件时 FileReader 用 IO 缓冲，浏览器内部 streamy 处理
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader 返回非字符串'));
        return;
      }
      // dataURL 形式 "data:<mime>;base64,<...>" — 取逗号后部分
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader 失败'));
    reader.readAsDataURL(file);
  });
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

  // 全集生成进度状态
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchRunning, setBatchRunning] = React.useState(false);
  const [batchProgress, setBatchProgress] = React.useState<{
    current: number;
    total: number;
    currentLabel: string;
    succeeded: number;
    failed: Array<{ episodeNumber: number; error: string }>;
  }>({ current: 0, total: 0, currentLabel: '', succeeded: 0, failed: [] });

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

  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'zh-CN';

  const publish = trpc.storyboard.publishEpisode.useMutation({
    onSuccess: (res) => {
      const aigcReady = res.groupCount > 0;
      // 用户反馈 r3:确认发布后 AIGC 模块要看到最新分镜 + prompt
      // AIGC 直接 query 活表,只需让 react-query cache 失效
      void utils.aigc.listGroups.invalidate({ episodeId: res.episodeId });
      void utils.aigc.getGroupDetail.invalidate();
      toast.success(
        aigcReady
          ? `已发布 v${res.version} · ${res.shotCount} 镜 / ${res.groupCount} 组 · 已同步到 AIGC`
          : `已发布 v${res.version}(${res.shotCount} 镜 / ${res.groupCount} 组 · 无分镜可同步到 AIGC)`,
        aigcReady
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

  const handleExportCurrent = async (): Promise<void> => {
    if (!episodeId) return;
    try {
      const data = await utils.storyboard.listShots.fetch({ episodeId, grouped: true });
      const csv = buildShotsCsv(data, episodeNumber ?? 0);
      downloadFile(csv, `第${episodeNumber ?? '?'}集分镜.csv`, 'text/csv;charset=utf-8;');
      toast.success('CSV 导出完成');
    } catch (e) {
      toast.error(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExportAll = async (): Promise<void> => {
    try {
      const data = await utils.storyboard.listShotsByProject.fetch({ projectId });
      const nonEmpty = data.episodes.filter((ep) => ep.shotCount > 0);
      if (nonEmpty.length === 0) {
        toast.warning('项目内还没有任何已生成的分镜');
        return;
      }
      const headerRow = buildShotsCsv({ groups: [], ungrouped: [] }, 0).split('\n')[0] ?? '';
      const bodies: string[] = [];
      for (const ep of nonEmpty) {
        const full = buildShotsCsv(
          { groups: ep.groups, ungrouped: ep.ungrouped },
          ep.episodeNumber,
        );
        // 去掉第一行(表头),只取数据行
        const lines = full.split('\n');
        if (lines.length > 1) bodies.push(lines.slice(1).join('\n'));
      }
      const csv = [headerRow, ...bodies].filter(Boolean).join('\n');
      downloadFile(
        csv,
        `项目全部分镜(${nonEmpty.length}集).csv`,
        'text/csv;charset=utf-8;',
      );
      toast.success(`已导出 ${nonEmpty.length} 集分镜`);
    } catch (e) {
      toast.error(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const disabled = !episodeId;

  const runBatch = async (): Promise<void> => {
    const eligible = eligibleQuery.data ?? [];
    if (eligible.length === 0) return;
    setBatchRunning(true);
    setBatchProgress({
      current: 0,
      total: eligible.length,
      currentLabel: '',
      succeeded: 0,
      failed: [],
    });
    for (let i = 0; i < eligible.length; i++) {
      const ep = eligible[i];
      if (!ep) continue;
      setBatchProgress((p) => ({
        ...p,
        current: i + 1,
        currentLabel: `第 ${ep.episodeNumber} 集${ep.title ? ` · ${ep.title}` : ''}`,
      }));
      try {
        await generate.mutateAsync({ episodeId: ep.episodeId, replaceExisting: true });
        setBatchProgress((p) => ({ ...p, succeeded: p.succeeded + 1 }));
      } catch (e) {
        setBatchProgress((p) => ({
          ...p,
          failed: [
            ...p.failed,
            {
              episodeNumber: ep.episodeNumber,
              error: e instanceof Error ? e.message : String(e),
            },
          ],
        }));
      }
    }
    setBatchRunning(false);
    onAfterAction();
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
          if (!o && batchRunning) return; // running 中不允许关
          setBatchOpen(o);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {batchRunning
                ? `生成中… ${batchProgress.current}/${batchProgress.total}`
                : batchProgress.total > 0
                  ? '生成结果'
                  : '为全部集生成分镜'}
            </DialogTitle>
            <DialogDescription>
              {batchRunning
                ? batchProgress.currentLabel
                : batchProgress.total > 0
                  ? `成功 ${batchProgress.succeeded} 集 · 失败 ${batchProgress.failed.length} 集`
                  : '只列出"有剧本 + 未锁"的集。生成串行进行,失败的集会跳过(不影响其它)。'}
            </DialogDescription>
          </DialogHeader>
          {!batchRunning && batchProgress.total === 0 && (
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
          {(batchRunning || batchProgress.total > 0) && batchProgress.failed.length > 0 && (
            <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-red-500/40 p-2 text-xs">
              {batchProgress.failed.map((f) => (
                <div key={f.episodeNumber} className="text-red-500">
                  第 {f.episodeNumber} 集: {f.error}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            {batchRunning ? (
              <Button variant="outline" size="sm" disabled>
                运行中…
              </Button>
            ) : batchProgress.total > 0 ? (
              <Button
                size="sm"
                onClick={() => {
                  setBatchOpen(false);
                  setBatchProgress({
                    current: 0,
                    total: 0,
                    currentLabel: '',
                    succeeded: 0,
                    failed: [],
                  });
                }}
              >
                关闭
              </Button>
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
                  开始生成({(eligibleQuery.data ?? []).length} 集)
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
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={handleExportCurrent} disabled={disabled}>
            <FileText className="mr-2 size-3.5" />
            当前集 CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportAll}>
            <Package className="mr-2 size-3.5" />
            全部集 CSV(合并)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
