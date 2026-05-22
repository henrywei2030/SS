'use client';
import * as React from 'react';
import { Loader2, Sparkles, Upload, FileText, ListChecks, Send } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  projectId: string;
  episodeId: string | undefined;
  episodeNumber: number | undefined;
  tab: 'script' | 'shots';
  onTabChange: (t: 'script' | 'shots') => void;
  onAfterAction: () => void;
}

export function TopBar({
  projectId,
  episodeId,
  episodeNumber,
  tab,
  onTabChange,
  onAfterAction,
}: Props): React.ReactElement {
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
        {tab === 'script' ? (
          <ScriptActions
            projectId={projectId}
            currentEpisodeNumber={episodeNumber}
            onSaved={onAfterAction}
          />
        ) : (
          <ShotsActions episodeId={episodeId} onAfterAction={onAfterAction} />
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

  // 选中集变化时同步集号(避免误传到错集)
  React.useEffect(() => {
    if (currentEpisodeNumber !== undefined) {
      setEpisodeNumber(currentEpisodeNumber);
    }
  }, [currentEpisodeNumber]);

  const uploadFile = trpc.script.uploadFile.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.created
          ? `第 ${res.episode.number} 集 V${res.script.version} 上传成功（${res.format} · ${res.parsedSceneCount} 场）`
          : '内容未变化，未创建新版本',
      );
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);
      uploadFile.mutate({
        projectId,
        episodeNumber,
        filename: file.name,
        fileBase64: base64,
        title: file.name.replace(/\.[a-z0-9]+$/i, ''),
      });
    } catch (err) {
      toast.error(`文件读取失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = ''; // 允许重选同一文件
    }
  };

  return (
    <>
      <input
        type="number"
        min={1}
        value={episodeNumber}
        onChange={(e) => setEpisodeNumber(Number(e.target.value))}
        className="h-7 w-14 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-sm"
        title="集号(默认跟随左栏选中集,改成新数字则上传到新集)"
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
        disabled={uploadFile.isPending}
        className="gap-1.5"
        title="支持 docx / txt / md / rtf / html"
      >
        {uploadFile.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Upload className="size-3.5" />
        )}
        上传剧本
      </Button>
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
  episodeId,
  onAfterAction,
}: {
  episodeId: string | undefined;
  onAfterAction: () => void;
}): React.ReactElement {
  const generate = trpc.storyboard.generateForEpisode.useMutation({
    onSuccess: (res) => {
      const msg = `生成完成：${res.shotCount} 镜，${res.groupCount} 组`;
      if (res.errors.length > 0) {
        toast.warning(`${msg}（${res.errors.length} 场有警告）`);
      } else {
        toast.success(msg);
      }
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  const publish = trpc.storyboard.publishEpisode.useMutation({
    onSuccess: (res) => {
      toast.success(`已发布 v${res.version}（${res.shotCount} 镜 / ${res.groupCount} 组）`);
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  const disabled = !episodeId;

  return (
    <>
      <Button
        size="sm"
        variant="default"
        onClick={() => episodeId && generate.mutate({ episodeId, replaceExisting: false })}
        disabled={disabled || generate.isPending}
        className="gap-1.5"
      >
        {generate.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        生成分镜
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
