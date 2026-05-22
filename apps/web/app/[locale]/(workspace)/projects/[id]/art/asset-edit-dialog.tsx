'use client';
import * as React from 'react';
import { Loader2, Save, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type AssetType = 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE';

const CHARACTER_ROLES = [
  '主演-男主',
  '主演-女主',
  '主演-反派',
  '配角-正派',
  '配角-反派',
  '配角-中性',
  '群演',
] as const;

interface PropsCommon {
  onClose: () => void;
  onSaved: () => void;
}

type Props =
  | (PropsCommon & { assetId: string; projectId?: never; createType?: never })
  | (PropsCommon & { assetId?: never; projectId: string; createType: AssetType });

export function AssetEditDialog(props: Props): React.ReactElement {
  if ('assetId' in props && props.assetId) {
    return <UpdateMode assetId={props.assetId} onClose={props.onClose} onSaved={props.onSaved} />;
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
// Update mode — 编辑已有资产
// ---------------------------------------------------------------------------

function UpdateMode({
  assetId,
  onClose,
  onSaved,
}: {
  assetId: string;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { data: asset, isLoading } = trpc.asset.get.useQuery({ assetId });

  if (isLoading || !asset) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <EditForm
      mode="update"
      initial={{
        name: asset.name,
        alias: asset.alias,
        description: asset.description ?? '',
        prompt: asset.prompt,
        characterRole: asset.characterRole,
        tags: asset.tags,
        type: asset.type as AssetType,
      }}
      assetId={assetId}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

// ---------------------------------------------------------------------------
// Create mode — 新建资产
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
  return (
    <EditForm
      mode="create"
      initial={{
        name: '',
        alias: [],
        description: '',
        prompt: '',
        characterRole: null,
        tags: [],
        type,
      }}
      projectId={projectId}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------

interface FormData {
  name: string;
  alias: string[];
  description: string;
  prompt: string;
  characterRole: string | null;
  tags: string[];
  type: AssetType;
}

function EditForm({
  mode,
  initial,
  assetId,
  projectId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'update';
  initial: FormData;
  assetId?: string;
  projectId?: string;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [form, setForm] = React.useState<FormData>(initial);
  const [diffNote, setDiffNote] = React.useState('');

  const createMut = trpc.asset.create.useMutation({
    onSuccess: () => {
      toast.success('资产已创建');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.asset.update.useMutation({
    onSuccess: () => {
      toast.success('已保存 · 改动入 PromptEdit 训练集');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.asset.delete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const pending = createMut.isPending || updateMut.isPending || deleteMut.isPending;

  const handleSave = (): void => {
    if (!form.name.trim() || !form.prompt.trim()) {
      toast.error('name 和 prompt 不能为空');
      return;
    }
    if (mode === 'create') {
      createMut.mutate({
        projectId: projectId!,
        type: form.type,
        name: form.name.trim(),
        alias: form.alias.filter(Boolean),
        description: form.description,
        prompt: form.prompt,
        ...(form.characterRole && form.type === 'CHARACTER'
          ? { characterRole: form.characterRole as (typeof CHARACTER_ROLES)[number] }
          : {}),
        tags: form.tags.filter(Boolean),
      });
    } else {
      // 只传发生变化的字段
      const patch: Record<string, unknown> = {};
      if (form.name !== initial.name) patch.name = form.name.trim();
      if (JSON.stringify(form.alias) !== JSON.stringify(initial.alias))
        patch.alias = form.alias.filter(Boolean);
      if (form.description !== initial.description) patch.description = form.description;
      if (form.prompt !== initial.prompt) patch.prompt = form.prompt;
      if (form.characterRole !== initial.characterRole)
        patch.characterRole = form.characterRole;
      if (JSON.stringify(form.tags) !== JSON.stringify(initial.tags))
        patch.tags = form.tags.filter(Boolean);

      if (Object.keys(patch).length === 0) {
        toast.info('没有改动');
        return;
      }
      updateMut.mutate({
        assetId: assetId!,
        patch: patch as never,
        diffNote: diffNote || undefined,
      });
    }
  };

  const handleDelete = (): void => {
    if (!assetId) return;
    if (!confirm(`确认删除资产 "${form.name}"?`)) return;
    deleteMut.mutate({ assetId });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? '新建' : '编辑'}
            {' · '}
            {form.type === 'CHARACTER'
              ? '人物'
              : form.type === 'SCENE'
                ? '场景'
                : form.type === 'PROP'
                  ? '道具'
                  : '风格参考'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'update'
              ? '修改 name / description / prompt 后保存,会自动写入 PromptEdit 训练集'
              : '填好基本信息和提示词,后续可生成主形象 / 三视图'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="name">名称 *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如 陆乘 / 陆乘家破土屋"
              />
            </div>
            {form.type === 'CHARACTER' && (
              <div className="grid gap-1.5">
                <Label htmlFor="role">角色身份</Label>
                <select
                  id="role"
                  value={form.characterRole ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      characterRole: e.target.value || null,
                    })
                  }
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

          <div className="grid gap-1.5">
            <Label htmlFor="alias">别名(逗号分隔,自动 @ 匹配用)</Label>
            <Input
              id="alias"
              value={form.alias.join(', ')}
              onChange={(e) =>
                setForm({
                  ...form,
                  alias: e.target.value
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="阿乘, 哥, 乘哥"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">描述</Label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm"
              placeholder="20-25 岁男性,身材消瘦但坚毅,短发,衣着朴素"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="prompt">提示词 * (送图像模型用)</Label>
            <textarea
              id="prompt"
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              rows={5}
              className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 font-mono text-[12px] leading-relaxed"
              placeholder="20-25 岁中国男性,身材消瘦但骨骼分明,短发偏粗硬,眼神坚毅有戏,80 年代农村粗布衣裤"
            />
            <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              {form.prompt.length} 字 · 建议 50-150 字
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tags">标签(逗号分隔)</Label>
            <Input
              id="tags"
              value={form.tags.join(', ')}
              onChange={(e) =>
                setForm({
                  ...form,
                  tags: e.target.value
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="坚毅, 重情义, 逆境重生"
            />
          </div>

          {mode === 'update' && (
            <div className="grid gap-1.5">
              <Label htmlFor="diffNote" className="flex items-center gap-1.5">
                <Sparkles className="size-3 text-[hsl(var(--color-accent))]" />
                修改原因(可选,会一起入训练集)
              </Label>
              <Input
                id="diffNote"
                value={diffNote}
                onChange={(e) => setDiffNote(e.target.value)}
                placeholder="例:AI 拆解忽略了角色后期的服装变化,人工补充"
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          {mode === 'update' && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={pending}
              className="gap-1.5"
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={pending} className="gap-1.5">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {mode === 'create' ? '创建' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
