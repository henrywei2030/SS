'use client';
import * as React from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

// ---------------------------------------------------------------------------
// 出场绑定 list(放在左信息区)
// ---------------------------------------------------------------------------

export function UsageBindingsList({
  assetId,
  projectId,
  onChanged,
}: {
  assetId: string;
  projectId: string;
  onChanged: () => void;
}): React.ReactElement {
  const { data: bindings, refetch } = trpc.asset.listBindings.useQuery({ assetId });
  const { data: episodes } = trpc.storyboard.listEpisodes.useQuery({ projectId });

  const [adding, setAdding] = React.useState(false);
  const [newEp, setNewEp] = React.useState('');

  const bindMut = trpc.asset.bindUsage.useMutation({
    onSuccess: () => {
      toast.success('已绑定');
      setAdding(false);
      setNewEp('');
      void refetch();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const unbindMut = trpc.asset.unbindUsage.useMutation({
    onSuccess: () => {
      void refetch();
      onChanged();
    },
  });

  return (
    <div className="grid gap-1.5 border-t border-[hsl(var(--color-border)/0.5)] pt-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
          出场管理 ({bindings?.length ?? 0} 集)
        </Label>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] text-[hsl(var(--color-accent))] hover:underline"
        >
          {adding ? '取消' : '+ 添加'}
        </button>
      </div>

      {adding && (
        <div className="flex gap-1">
          <select
            value={newEp}
            onChange={(e) => setNewEp(e.target.value)}
            className="h-7 flex-1 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
          >
            <option value="">选集</option>
            {episodes?.map((ep) => (
              <option key={ep.id} value={ep.id}>
                第 {ep.number} 集{ep.title ? ` · ${ep.title}` : ''}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={() =>
              newEp && bindMut.mutate({ assetId, episodeId: newEp, usageType: 'APPEAR' })
            }
            disabled={!newEp || bindMut.isPending}
            className="h-7 px-2 text-xs"
          >
            绑定
          </Button>
        </div>
      )}

      {bindings && bindings.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {bindings.map((b) => (
            <span
              key={b.id}
              className="group flex items-center gap-1 rounded bg-[hsl(var(--color-accent)/0.12)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--color-accent))]"
            >
              第{b.episode.number}集
              {b.scene?.number ? `-${b.scene.number}` : ''}
              <button
                onClick={() => unbindMut.mutate({ bindingId: b.id })}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
          还没有出场绑定 · 添加后下方资产卡片底部会显示
        </p>
      )}
    </div>
  );
}
