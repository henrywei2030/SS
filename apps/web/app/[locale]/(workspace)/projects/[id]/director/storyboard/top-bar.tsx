'use client';
import * as React from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { trpc } from '@/lib/trpc/client';

type ListShotsResult = inferRouterOutputs<AppRouter>['storyboard']['listShots'];
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
        {tab === 'script' ? (
          <ScriptActions
            projectId={projectId}
            currentEpisodeNumber={episodeNumber}
            onSaved={onAfterAction}
          />
        ) : (
          <ShotsActions
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
  episodeNumber,
  onAfterAction,
}: {
  episodeId: string | undefined;
  episodeNumber: number | undefined;
  onAfterAction: () => void;
}): React.ReactElement {
  const utils = trpc.useUtils();

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

  const handleExport = async (): Promise<void> => {
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
        onClick={handleExport}
        disabled={disabled}
        className="gap-1.5"
        title="导出为 CSV(Excel 可直接打开)"
      >
        <Download className="size-3.5" />
        导出
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
