'use client';
import * as React from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { type AssetType, SLOTS_BY_TYPE, CHARACTER_ROLES } from './asset-edit-shared';
import { InfoPanel } from './asset-edit-info-panel';
import { GenerationPanel } from './asset-edit-generation-panel';
import { ConfirmedSlotsPanel } from './asset-edit-confirmed-panel';

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

interface PropsCommon {
  onClose: () => void;
  onSaved: () => void;
}

type Props =
  | (PropsCommon & { assetId: string; projectId?: never; createType?: never })
  | (PropsCommon & { assetId?: never; projectId: string; createType: AssetType });

export function AssetEditDialog(props: Props): React.ReactElement {
  if ('assetId' in props && props.assetId) {
    return <UpdateMode assetId={props.assetId} onClose={props.onClose} />;
  }
  return (
    <CreateMode
      projectId={props.projectId!}
      type={props.createType!}
      onClose={props.onClose}
      onSaved={props.onSaved}
    />
  );
}

// ---------------------------------------------------------------------------
// 编辑模式 — 三栏完整工作台
// ---------------------------------------------------------------------------

function UpdateMode({
  assetId,
  onClose,
}: {
  assetId: string;
  onClose: () => void;
}): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: asset, isLoading, refetch } = trpc.asset.get.useQuery({ assetId });

  if (isLoading || !asset) {
    return (
      <DialogShell onClose={onClose}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin" />
        </div>
      </DialogShell>
    );
  }

  const type = asset.type as AssetType;
  const slots = SLOTS_BY_TYPE[type];

  const handleAfterChange = (): void => {
    void refetch();
    void utils.asset.list.invalidate({ projectId: asset.projectId });
  };

  return (
    <DialogShell onClose={onClose}>
      <div className="grid h-full grid-cols-[440px_1fr_300px] divide-x divide-[hsl(var(--color-border))]">
        <InfoPanel asset={asset} onChanged={handleAfterChange} />
        <GenerationPanel
          asset={asset}
          onChanged={handleAfterChange}
        />
        <ConfirmedSlotsPanel
          asset={asset}
          slots={slots}
          onChanged={handleAfterChange}
        />
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// 创建模式 — 单栏简化(填基本信息 + 创建,创建后用户可重打开走编辑模式)
// ---------------------------------------------------------------------------

function CreateMode({
  projectId,
  type,
  onClose,
  onSaved,
}: {
  projectId: string;
  type: AssetType;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [name, setName] = React.useState('');
  const [archetypeKey, setArchetypeKey] = React.useState('');
  const [characterRole, setCharacterRole] = React.useState<string>('');
  const [description, setDescription] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [tags, setTags] = React.useState('');
  const [alias, setAlias] = React.useState('');

  const createMut = trpc.asset.create.useMutation({
    onSuccess: () => {
      toast.success('资产已创建');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = (): void => {
    if (!name.trim() || !prompt.trim()) {
      toast.error('名称和提示词必填');
      return;
    }
    createMut.mutate({
      projectId,
      type,
      name: name.trim(),
      archetypeKey: archetypeKey.trim() || undefined,
      description,
      prompt,
      alias: alias.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      tags: tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      ...(type === 'CHARACTER' && characterRole
        ? { characterRole: characterRole as (typeof CHARACTER_ROLES)[number] }
        : {}),
    });
  };

  const typeLabel =
    type === 'CHARACTER' ? '人物' : type === 'SCENE' ? '场景' : type === 'PROP' ? '道具' : '风格参考';

  return (
    <DialogShell onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">新建{typeLabel}资产</h2>
        <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
          填好基本信息和提示词,创建后可在编辑弹窗中生成主形象 / 三视图 / 多角度。
        </p>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="grid gap-1.5">
            <Label htmlFor="name">名称 *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'CHARACTER' ? '陆乘 - 重生初期' : '土屋 / 灵泉水玉瓶'}
            />
          </div>
          {type === 'CHARACTER' && (
            <div className="grid gap-1.5">
              <Label htmlFor="role">角色身份</Label>
              <select
                id="role"
                value={characterRole}
                onChange={(e) => setCharacterRole(e.target.value)}
                className="h-9 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-sm"
              >
                <option value="">— 未指定 —</option>
                {CHARACTER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {type === 'CHARACTER' && (
          <div className="grid gap-1.5">
            <Label htmlFor="arch" className="flex items-center gap-1.5">
              原型 key
              <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                (同人物不同时期共享,如"陆乘";不填则视为独立角色)
              </span>
            </Label>
            <Input
              id="arch"
              value={archetypeKey}
              onChange={(e) => setArchetypeKey(e.target.value)}
              placeholder="陆乘"
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="alias">别名(逗号分隔)</Label>
          <Input
            id="alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="阿乘, 哥, 乘哥"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="desc">描述</Label>
          <textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="prompt">提示词 *</Label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 font-mono text-[12px]"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="tags">标签(逗号分隔)</Label>
          <Input
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="坚毅, 重情义"
          />
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={createMut.isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={createMut.isPending} className="gap-1.5">
            {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            创建
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// 弹窗外壳 — 大尺寸三栏
// ---------------------------------------------------------------------------

function DialogShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative h-[90vh] w-full max-w-[1480px] overflow-hidden rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)] hover:text-[hsl(var(--color-foreground))]"
          aria-label="关闭"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
