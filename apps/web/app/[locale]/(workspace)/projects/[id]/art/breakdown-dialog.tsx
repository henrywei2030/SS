'use client';
import * as React from 'react';
import { Loader2, Sparkles, Check } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
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
import { Label } from '@/components/ui/label';

interface Props {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

type AssetType = 'CHARACTER' | 'SCENE' | 'PROP';
type CharacterRole =
  | '主演-男主'
  | '主演-女主'
  | '主演-反派'
  | '配角-正派'
  | '配角-反派'
  | '配角-中性'
  | '群演';

const VALID_ROLES = new Set<CharacterRole>([
  '主演-男主',
  '主演-女主',
  '主演-反派',
  '配角-正派',
  '配角-反派',
  '配角-中性',
  '群演',
]);

interface DraftItem {
  type: AssetType;
  name: string;
  alias: string[];
  description: string;
  prompt: string;
  characterRole?: string;
  tags: string[];
}

export function BreakdownDialog({ projectId, onClose, onSaved }: Props): React.ReactElement {
  const [episodeId, setEpisodeId] = React.useState<string>('');
  const [drafts, setDrafts] = React.useState<DraftItem[] | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const { data: episodes } = trpc.storyboard.listEpisodes.useQuery({ projectId });

  const breakdown = trpc.asset.breakdown.useMutation({
    onSuccess: (res) => {
      const all: DraftItem[] = [
        ...res.characters,
        ...res.scenes,
        ...res.props,
      ];
      setDrafts(all);
      // 默认全选
      setSelected(new Set(all.map((_, i) => i)));
      toast.success(
        `LLM 拆解完成 · ${res.characters.length} 人物 / ${res.scenes.length} 场景 / ${res.props.length} 道具 · ¥${res.cost.toFixed(4)}`,
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const batchCreate = trpc.asset.batchCreate.useMutation({
    onSuccess: (res) => {
      toast.success(
        `已入库 ${res.created.length} 个资产` +
          (res.skipped.length > 0 ? ` · 跳过 ${res.skipped.length} 个同名` : ''),
      );
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleBreakdown = (): void => {
    breakdown.mutate({
      projectId,
      ...(episodeId ? { episodeId } : {}),
    });
  };

  const handleImport = (): void => {
    if (!drafts) return;
    const items = drafts
      .filter((_, i) => selected.has(i))
      .map((d) => ({
        type: d.type,
        name: d.name,
        alias: d.alias,
        description: d.description,
        prompt: d.prompt,
        tags: d.tags,
        // 过滤 LLM 给出的非白名单 characterRole
        ...(d.type === 'CHARACTER' &&
        d.characterRole &&
        VALID_ROLES.has(d.characterRole as CharacterRole)
          ? { characterRole: d.characterRole as CharacterRole }
          : {}),
      }));
    if (items.length === 0) {
      toast.error('请至少勾选 1 个');
      return;
    }
    batchCreate.mutate({ projectId, drafts: items });
  };

  const pending = breakdown.isPending || batchCreate.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>从剧本拆解资产</DialogTitle>
          <DialogDescription>
            选一集(或不选 = 用项目当前主剧本),调 LLM 自动识别人物 / 场景 / 道具
            的 prompt 草稿。审阅后批量入库,后续可单独编辑 + 生成主形象图。
          </DialogDescription>
        </DialogHeader>

        {!drafts ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ep">剧本来源</Label>
              <select
                id="ep"
                value={episodeId}
                onChange={(e) => setEpisodeId(e.target.value)}
                className="h-9 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-sm"
              >
                <option value="">— 整剧主剧本 / 最新单集 —</option>
                {episodes?.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    第 {ep.number} 集 {ep.title ? `· ${ep.title}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={handleBreakdown} disabled={pending} className="gap-1.5">
              {breakdown.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              开始拆解
            </Button>
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-auto">
            <div className="flex items-center justify-between text-xs text-[hsl(var(--color-muted-foreground))]">
              <span>共 {drafts.length} 个,已选 {selected.size} 个 · 重名将自动跳过</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelected(new Set(drafts.map((_, i) => i)))}
                  className="text-[hsl(var(--color-accent))] hover:underline"
                >
                  全选
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="hover:underline"
                >
                  清空
                </button>
              </div>
            </div>
            {drafts.map((d, i) => {
              const checked = selected.has(i);
              return (
                <label
                  key={i}
                  className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 ${
                    checked
                      ? 'border-[hsl(var(--color-accent)/0.5)] bg-[hsl(var(--color-accent)/0.05)]'
                      : 'border-[hsl(var(--color-border))]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selected);
                      if (checked) next.delete(i);
                      else next.add(i);
                      setSelected(next);
                    }}
                    className="mt-0.5 accent-[hsl(var(--color-accent))]"
                  />
                  <div className="flex-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{d.name}</span>
                      <Badge variant="secondary" className="px-1 text-[9px]">
                        {d.type === 'CHARACTER'
                          ? '人物'
                          : d.type === 'SCENE'
                            ? '场景'
                            : '道具'}
                      </Badge>
                      {d.characterRole && (
                        <Badge variant="default" className="px-1 text-[9px]">
                          {d.characterRole}
                        </Badge>
                      )}
                    </div>
                    {d.alias.length > 0 && (
                      <div className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        @ {d.alias.join(' / ')}
                      </div>
                    )}
                    <div className="mt-1 text-[hsl(var(--color-muted-foreground))]">{d.description}</div>
                    <div className="mt-1 font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {d.prompt}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          {drafts && (
            <Button onClick={handleImport} disabled={pending} className="gap-1.5">
              {batchCreate.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              批量入库 ({selected.size})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
