'use client';
import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Props {
  episodeId: string;
}

export function ScriptPane({ episodeId }: Props): React.ReactElement {
  const { data: versions, isLoading, refetch } = trpc.script.listVersions.useQuery({ episodeId });
  const current = versions?.find((v) => v.isCurrent);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();

  // 切集时重置选中版本,避免拿到上一集的 scriptId 显示串集
  React.useEffect(() => {
    setSelectedId(undefined);
  }, [episodeId]);

  // 若 selectedId 在新的 versions 列表里已不存在(被删除),也清掉
  React.useEffect(() => {
    if (selectedId && versions && !versions.some((v) => v.id === selectedId)) {
      setSelectedId(undefined);
    }
  }, [selectedId, versions]);

  const selectedVersionId = selectedId ?? current?.id;

  // 通过 trpc.useUtils 取 content;listVersions 不带 content。
  // 简化：直接调 latestAnalysis 不行，没有 content endpoint。
  // 这里 fallback：从 script.list 取本集对应当前剧本(含 content) — 但需 projectId。
  // 为最小实现，加一个临时 endpoint 来取单个 script content。
  // TODO(W3.2.x)：scriptRouter 加 getById(scriptId) 取 content。

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[hsl(var(--color-muted-foreground))]" />
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="max-w-md text-center text-sm text-[hsl(var(--color-muted-foreground))]">
          本集还没有剧本。点击顶部"上传 docx"导入剧本文件，或在剧本列表页粘贴文本。
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 版本切换条 */}
      <div className="flex items-center gap-2 border-b border-[hsl(var(--color-border))] px-4 py-2 text-xs">
        <span className="text-[hsl(var(--color-muted-foreground))]">版本</span>
        {versions.map((v) => (
          <VersionPill
            key={v.id}
            version={v}
            active={selectedVersionId === v.id}
            onClick={() => setSelectedId(v.id)}
            onAfterAction={() => void refetch()}
          />
        ))}
      </div>

      {/* 剧本内容 */}
      {selectedVersionId && <ScriptContentView scriptId={selectedVersionId} />}
    </div>
  );
}

function VersionPill({
  version,
  active,
  onClick,
  onAfterAction,
}: {
  version: {
    id: string;
    version: number;
    isCurrent: boolean;
    lockedAt: Date | null;
  };
  active: boolean;
  onClick: () => void;
  onAfterAction: () => void;
}): React.ReactElement {
  const setCurrent = trpc.script.setCurrentVersion.useMutation({
    onSuccess: () => {
      toast.success(`已切换到 V${version.version}`);
      onAfterAction();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <button
      onClick={onClick}
      onDoubleClick={() => !version.isCurrent && setCurrent.mutate({ scriptId: version.id })}
      title={
        version.isCurrent
          ? '当前版本'
          : '点击预览 · 双击设为当前版本'
      }
      className={`flex items-center gap-1 rounded px-2 py-1 transition-colors ${
        active
          ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
          : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]'
      }`}
    >
      V{version.version}
      {version.isCurrent && (
        <Badge variant="success" className="px-1 text-[9px]">
          current
        </Badge>
      )}
      {version.lockedAt && (
        <Badge variant="secondary" className="px-1 text-[9px]">
          locked
        </Badge>
      )}
    </button>
  );
}

function ScriptContentView({ scriptId }: { scriptId: string }): React.ReactElement {
  const { data, isLoading } = trpc.script.getById.useQuery({ scriptId });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-[hsl(var(--color-muted-foreground))]" />
      </div>
    );
  }

  if (!data) return <></>;

  return (
    <div className="flex-1 overflow-auto p-6">
      <pre className="whitespace-pre-wrap font-sans text-[13px] leading-[1.7] text-[hsl(var(--color-foreground))]">
        {data.content}
      </pre>
    </div>
  );
}
