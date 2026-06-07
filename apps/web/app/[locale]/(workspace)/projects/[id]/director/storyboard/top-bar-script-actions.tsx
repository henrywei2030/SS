'use client';
import * as React from 'react';
import { Loader2, Upload, Link2 } from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fileToBase64 } from '@/lib/file-to-base64';

type PreviewResult = inferRouterOutputs<AppRouter>['script']['previewParseFile'];

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

export function ScriptActions({
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
