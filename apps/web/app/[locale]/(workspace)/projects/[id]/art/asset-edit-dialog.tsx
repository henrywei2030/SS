'use client';
import * as React from 'react';
import {
  Loader2,
  Sparkles,
  Trash2,
  X,
  Lock,
  Unlock,
  Image as ImageIcon,
  CheckCircle2,
  Check,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { trpc } from '@/lib/trpc/client';

type AssetDetail = inferRouterOutputs<AppRouter>['asset']['get'];
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// 五六收工:剧本拆解档案字段(与导演 script-breakdown-pane 共享同一份 Asset)
import {
  GENDER_LABEL,
  LifeNodesEditor,
  parseProfileJson,
  buildProfileJson,
  type Gender,
  type LifeNode,
} from '@/components/asset-profile-fields';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// 类型 + 槽位定义
// ---------------------------------------------------------------------------

type AssetType = 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE';
type Slot =
  | 'portrait'
  | 'three_view'
  | 'scene_main'
  | 'scene_front'
  | 'scene_left'
  | 'scene_right'
  | 'scene_back'
  | 'panorama'
  | 'main';

const SLOTS_BY_TYPE: Record<AssetType, Array<{ slot: Slot; label: string; aspectClass: string }>> = {
  CHARACTER: [
    { slot: 'portrait', label: '已确认人物形象 (9:16)', aspectClass: 'aspect-[9/16]' },
    { slot: 'three_view', label: '已确认三视图 (16:9)', aspectClass: 'aspect-[16/9]' },
  ],
  SCENE: [
    { slot: 'scene_main', label: '主视角', aspectClass: 'aspect-[16/9]' },
    { slot: 'scene_front', label: '正面视角', aspectClass: 'aspect-[16/9]' },
    { slot: 'scene_left', label: '左侧视角', aspectClass: 'aspect-[16/9]' },
    { slot: 'scene_right', label: '右侧视角', aspectClass: 'aspect-[16/9]' },
    { slot: 'scene_back', label: '背面视角', aspectClass: 'aspect-[16/9]' },
    { slot: 'panorama', label: '360° 全景', aspectClass: 'aspect-[2/1]' },
  ],
  PROP: [{ slot: 'main', label: '主图', aspectClass: 'aspect-square' }],
  STYLE_REFERENCE: [{ slot: 'main', label: '风格参考图', aspectClass: 'aspect-square' }],
};

const SLOT_FIELD: Record<Slot, string> = {
  portrait: 'portraitMediaId',
  three_view: 'threeViewMediaId',
  scene_main: 'sceneMainMediaId',
  scene_front: 'sceneFrontMediaId',
  scene_left: 'sceneLeftMediaId',
  scene_right: 'sceneRightMediaId',
  scene_back: 'sceneBackMediaId',
  panorama: 'panoramaMediaId',
  main: 'mainMediaId',
};

const CHARACTER_ROLES = [
  '主演-男主',
  '主演-女主',
  '主演-反派',
  '配角-正派',
  '配角-反派',
  '配角-中性',
  '群演',
] as const;

const RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3', '2:1'] as const;
const SIZES = ['1K (1024)', '2K (2048)', '4K (4096)'] as const;

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
// 编辑模式 — 三栏完整工作台
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
      <div className="grid h-full grid-cols-[280px_1fr_300px] divide-x divide-[hsl(var(--color-border))]">
        <InfoPanel asset={asset} onChanged={handleAfterChange} />
        <GenerationPanel
          asset={asset}
          onChanged={() => {
            handleAfterChange();
            onSaved();
          }}
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
        className="relative h-[90vh] w-full max-w-[1280px] overflow-hidden rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] shadow-2xl"
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

// ---------------------------------------------------------------------------
// 左:信息区
// ---------------------------------------------------------------------------

function InfoPanel({
  asset,
  onChanged,
}: {
  asset: AssetDetail;
  onChanged: () => void;
}): React.ReactElement {
  // 五六收工:editing 用 lazy init,把剧本拆解档案字段一并纳入(personalityTags 与 tags/alias 一样逗号分隔)
  const [editing, setEditing] = React.useState(() => {
    const profileInit = parseProfileJson(asset.profileJson);
    return {
      name: asset.name,
      archetypeKey: asset.archetypeKey ?? '',
      description: asset.description ?? '',
      prompt: asset.prompt,
      characterRole: asset.characterRole ?? '',
      tags: asset.tags.join(', '),
      alias: asset.alias.join(', '),
      gender: ((asset.gender as Gender | null) ?? '') as Gender | '',
      age: asset.age == null ? '' : String(asset.age),
      heightCm: asset.heightCm == null ? '' : String(asset.heightCm),
      mbti: asset.mbti ?? '',
      personalityTags: asset.personalityTags.join(', '),
      monologue: asset.monologue ?? '',
      lifeNodes: profileInit.lifeNodes as LifeNode[],
      voiceLabel: profileInit.voiceLabel,
    };
  });
  const [diffNote, setDiffNote] = React.useState('');

  const updateMut = trpc.asset.update.useMutation({
    onSuccess: () => {
      toast.success('已保存 · 改动入训练集');
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const lockMut = trpc.asset.lockAsset.useMutation({
    onSuccess: () => {
      toast.success('已锁定');
      onChanged();
    },
    onError: (e) => toast.error(`锁定失败: ${e.message}`),
  });
  const unlockMut = trpc.asset.unlockAsset.useMutation({
    onSuccess: () => {
      toast.success('已解锁');
      onChanged();
    },
    onError: (e) => toast.error(`解锁失败: ${e.message}`),
  });
  const deleteMut = trpc.asset.delete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const isLocked = !!asset.lockedAt;

  const handleSave = (): void => {
    const patch: Record<string, unknown> = {};
    if (editing.name !== asset.name) patch.name = editing.name;
    if (editing.archetypeKey !== (asset.archetypeKey ?? ''))
      patch.archetypeKey = editing.archetypeKey || null;
    if (editing.description !== (asset.description ?? '')) patch.description = editing.description;
    if (editing.prompt !== asset.prompt) patch.prompt = editing.prompt;
    if (editing.characterRole !== (asset.characterRole ?? '')) {
      patch.characterRole = editing.characterRole || null;
    }
    const newTags = editing.tags
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (JSON.stringify(newTags) !== JSON.stringify(asset.tags)) patch.tags = newTags;
    const newAlias = editing.alias
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (JSON.stringify(newAlias) !== JSON.stringify(asset.alias)) patch.alias = newAlias;

    // 五六收工:剧本拆解档案字段 diff(仅人物;空字符串 = 清除 = null)
    //   后端 update 不把这些列入 lock blockedFields,故锁定状态下也可微调档案
    if (asset.type === 'CHARACTER') {
      if (editing.gender !== ((asset.gender as string | null) ?? '')) {
        patch.gender = editing.gender || null;
      }
      const newAge = editing.age === '' ? null : Number(editing.age);
      if (newAge !== (asset.age ?? null)) patch.age = newAge;
      const newHeight = editing.heightCm === '' ? null : Number(editing.heightCm);
      if (newHeight !== (asset.heightCm ?? null)) patch.heightCm = newHeight;
      if (editing.mbti !== (asset.mbti ?? '')) patch.mbti = editing.mbti || null;
      const newPersonality = editing.personalityTags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (JSON.stringify(newPersonality) !== JSON.stringify(asset.personalityTags)) {
        patch.personalityTags = newPersonality;
      }
      if (editing.monologue !== (asset.monologue ?? '')) {
        patch.monologue = editing.monologue || null;
      }
      // profileJson 整体覆盖语义:跟当前归一化后比较,变了才传(否则白白触发训练集/写入)
      const cur = parseProfileJson(asset.profileJson);
      const curProfileJson = buildProfileJson(cur.lifeNodes, cur.voiceLabel);
      const newProfileJson = buildProfileJson(editing.lifeNodes, editing.voiceLabel);
      if (JSON.stringify(newProfileJson) !== JSON.stringify(curProfileJson)) {
        patch.profileJson = newProfileJson;
      }
    }

    if (Object.keys(patch).length === 0) {
      toast.info('没有改动');
      return;
    }
    updateMut.mutate({
      assetId: asset.id,
      patch: patch as never,
      diffNote: diffNote || undefined,
    });
  };

  const type = asset.type as AssetType;
  const typeLabel =
    type === 'CHARACTER' ? '人物' : type === 'SCENE' ? '场景' : type === 'PROP' ? '道具' : '风格';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{typeLabel}编辑</h3>
          {isLocked && (
            <Badge variant="secondary" className="gap-1 px-1.5 text-[10px]">
              <Lock className="size-2.5" />
              已锁定
            </Badge>
          )}
        </div>
        <div className="flex gap-1">
          {isLocked ? (
            <button
              onClick={() => unlockMut.mutate({ assetId: asset.id })}
              disabled={unlockMut.isPending}
              className="rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
              title="解锁"
            >
              <Unlock className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={() => lockMut.mutate({ assetId: asset.id })}
              disabled={lockMut.isPending}
              className="rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
              title="锁定(防误改)"
            >
              <Lock className="size-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              if (confirm(`删除资产 "${asset.name}"?`)) deleteMut.mutate({ assetId: asset.id });
            }}
            className="rounded p-1 text-[hsl(var(--color-destructive))] hover:bg-[hsl(var(--color-destructive)/0.1)]"
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            名称
          </Label>
          <Input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            disabled={isLocked}
            className="h-8 text-sm"
          />
        </div>

        {type === 'CHARACTER' && (
          <>
            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                原型 key(同人物不同时期共享)
              </Label>
              <Input
                value={editing.archetypeKey}
                onChange={(e) => setEditing({ ...editing, archetypeKey: e.target.value })}
                placeholder="陆乘"
                className="h-8 text-sm"
              />
            </div>

            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                角色身份
              </Label>
              <select
                value={editing.characterRole}
                onChange={(e) => setEditing({ ...editing, characterRole: e.target.value })}
                disabled={isLocked}
                className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-sm"
              >
                <option value="">— 未指定 —</option>
                {CHARACTER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            别名(逗号分隔)
          </Label>
          <Input
            value={editing.alias}
            onChange={(e) => setEditing({ ...editing, alias: e.target.value })}
            className="h-8 text-sm"
          />
        </div>

        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            描述
          </Label>
          <textarea
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            disabled={isLocked}
            rows={2}
            className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
          />
        </div>

        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            提示词
          </Label>
          <textarea
            value={editing.prompt}
            onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
            disabled={isLocked}
            rows={6}
            className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 font-mono text-[11px]"
          />
        </div>

        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            标签(逗号分隔)
          </Label>
          <Input
            value={editing.tags}
            onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
            className="h-8 text-sm"
          />
        </div>

        {/* 五六收工:角色档案 — 文字从剧本拆解同步、美术工坊也可微调(同一份 Asset)*/}
        {type === 'CHARACTER' && (
          <div className="grid gap-2 rounded border border-[hsl(var(--color-border)/0.6)] p-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                角色档案(剧本拆解同步)
              </Label>
              {asset.syncedToArtAt ? (
                <Badge variant="secondary" className="gap-1 px-1.5 text-[9px]">
                  <CheckCircle2 className="size-2.5" />
                  已同步
                </Badge>
              ) : (
                <span className="text-[9px] text-[hsl(var(--color-muted-foreground))]">
                  未同步(在「剧本拆解」生成/同步)
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div className="grid gap-1">
                <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">性别</Label>
                <select
                  value={editing.gender}
                  onChange={(e) =>
                    setEditing({ ...editing, gender: e.target.value as Gender | '' })
                  }
                  className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
                >
                  <option value="">—</option>
                  {(['MALE', 'FEMALE', 'OTHER'] as const).map((g) => (
                    <option key={g} value={g}>
                      {GENDER_LABEL[g]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">年龄</Label>
                <Input
                  type="number"
                  min={0}
                  max={200}
                  value={editing.age}
                  onChange={(e) => setEditing({ ...editing, age: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">身高cm</Label>
                <Input
                  type="number"
                  min={0}
                  max={300}
                  value={editing.heightCm}
                  onChange={(e) => setEditing({ ...editing, heightCm: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-1">
              <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">MBTI</Label>
              <Input
                value={editing.mbti}
                onChange={(e) =>
                  setEditing({ ...editing, mbti: e.target.value.toUpperCase().slice(0, 8) })
                }
                placeholder="INTJ"
                className="h-8 font-mono text-sm uppercase"
              />
            </div>

            <div className="grid gap-1">
              <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                性格标签(逗号分隔)
              </Label>
              <Input
                value={editing.personalityTags}
                onChange={(e) => setEditing({ ...editing, personalityTags: e.target.value })}
                placeholder="冷静, 强势, 重情义"
                className="h-8 text-sm"
              />
            </div>

            <div className="grid gap-1">
              <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                内心独白
              </Label>
              <textarea
                value={editing.monologue}
                onChange={(e) =>
                  setEditing({ ...editing, monologue: e.target.value.slice(0, 2000) })
                }
                rows={2}
                className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
              />
            </div>

            <div className="grid gap-1">
              <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                人生关键节点
              </Label>
              <LifeNodesEditor
                nodes={editing.lifeNodes}
                onChange={(nodes) => setEditing({ ...editing, lifeNodes: nodes })}
              />
            </div>

            <div className="grid gap-1">
              <Label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                嗓音特征
              </Label>
              <Input
                value={editing.voiceLabel}
                onChange={(e) =>
                  setEditing({ ...editing, voiceLabel: e.target.value.slice(0, 100) })
                }
                placeholder="低沉沙哑 / 清脆少年音 等"
                className="h-8 text-sm"
              />
            </div>
          </div>
        )}

        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            修改原因(可选,入训练集)
          </Label>
          <Input
            value={diffNote}
            onChange={(e) => setDiffNote(e.target.value)}
            placeholder="例:补充服装变化"
            className="h-8 text-sm"
          />
        </div>

        {/* 出场绑定 list */}
        <UsageBindingsList assetId={asset.id} projectId={asset.projectId} onChanged={onChanged} />
      </div>

      <div className="border-t border-[hsl(var(--color-border))] p-3">
        <Button
          onClick={handleSave}
          disabled={updateMut.isPending}
          size="sm"
          className="w-full gap-1.5"
        >
          {updateMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          保存
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 中:生成 + 预览 + 候选备用区
// ---------------------------------------------------------------------------

function GenerationPanel({
  asset,
  onChanged,
}: {
  asset: AssetDetail;
  onChanged: () => void;
}): React.ReactElement {
  const type = asset.type as AssetType;
  const slots = SLOTS_BY_TYPE[type];
  const [selectedSlot, setSelectedSlot] = React.useState<Slot>(slots[0]!.slot);
  const [modelId, setModelId] = React.useState('');
  const [aspectRatio, setAspectRatio] = React.useState<string>(
    selectedSlot === 'portrait' ? '9:16' : selectedSlot === 'panorama' ? '2:1' : '16:9',
  );
  const [sizePx, setSizePx] = React.useState<string>('2K (2048)');
  const [extraInstruction, setExtraInstruction] = React.useState('');
  const [count, setCount] = React.useState(1);

  const { data: candidates, refetch: refetchCandidates } = trpc.asset.listCandidates.useQuery({
    assetId: asset.id,
    slot: selectedSlot,
  });

  // 五六收工:图片模型下拉读真实 active IMAGE Provider(替原 hardcode 3 占位模型)
  const { data: imageProviders } = trpc.asset.listImageProviders.useQuery();

  const [infoOpen, setInfoOpen] = React.useState<
    | {
        attempt: NonNullable<typeof candidates>[number]['attempt'];
        media: NonNullable<typeof candidates>[number]['media'][number];
      }
    | null
  >(null);

  const generateMut = trpc.asset.generateImage.useMutation({
    onSuccess: (res) => {
      toast.success(
        `生成完成 · ${res.candidates.length} 张候选 · 成本 ¥${res.cost.toFixed(4)}`,
      );
      void refetchCandidates();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const confirmMut = trpc.asset.confirmCandidate.useMutation({
    onSuccess: () => {
      toast.success('已确认到资产槽位');
      void refetchCandidates();
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMut = trpc.asset.rejectCandidate.useMutation({
    onSuccess: () => {
      toast.success('已删除候选');
      void refetchCandidates();
    },
  });

  React.useEffect(() => {
    setAspectRatio(
      selectedSlot === 'portrait'
        ? '9:16'
        : selectedSlot === 'panorama'
          ? '2:1'
          : selectedSlot === 'three_view'
            ? '16:9'
            : '16:9',
    );
  }, [selectedSlot]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[hsl(var(--color-border))] px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">生成 + 预览</h3>
          <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
            <Info className="size-3" />
            生成的图自动写到候选池,点&quot;设为槽位&quot;才确认
          </div>
        </div>

        {/* 槽位 tab */}
        <div className="mt-2 flex flex-wrap gap-1">
          {slots.map((s) => (
            <button
              key={s.slot}
              onClick={() => setSelectedSlot(s.slot)}
              className={cn(
                'rounded px-2 py-1 text-[11px]',
                selectedSlot === s.slot
                  ? 'bg-[hsl(var(--color-accent)/0.15)] text-[hsl(var(--color-accent))]'
                  : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* 生成参数 */}
        <div className="mt-2 grid grid-cols-4 gap-2">
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
            title="默认 = 用后台 binding 配的图片模型;也可显式切到某个已配 Provider"
          >
            <option value="">默认模型(绑定)</option>
            {imageProviders?.map((p) => (
              <option key={p.providerId} value={p.providerId}>
                {p.displayName || p.providerId}
              </option>
            ))}
          </select>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
          >
            {RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={sizePx}
            onChange={(e) => setSizePx(e.target.value)}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-xs"
          >
            {[1, 2, 3, 4].map((c) => (
              <option key={c} value={c}>
                生成 {c} 张
              </option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex gap-2">
          <Input
            value={extraInstruction}
            onChange={(e) => setExtraInstruction(e.target.value)}
            placeholder="额外指令(可选,如&quot;增加雨天氛围&quot;)"
            className="h-8 flex-1 text-xs"
          />
          <Button
            onClick={() =>
              generateMut.mutate({
                assetId: asset.id,
                slot: selectedSlot,
                count,
                modelId: modelId || undefined,
                aspectRatio,
                sizePx,
                extraInstruction: extraInstruction || undefined,
              })
            }
            disabled={generateMut.isPending}
            size="sm"
            className="gap-1.5"
          >
            {generateMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            开始生成
          </Button>
        </div>
      </div>

      {/* 候选图栅格 */}
      <div className="flex-1 overflow-y-auto p-4">
        {!candidates || candidates.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ImageIcon className="mb-3 size-12 text-[hsl(var(--color-muted-foreground)/0.4)]" />
            <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
              本槽位还没有候选图,点上方&quot;开始生成&quot;
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {candidates.flatMap((c) =>
              c.media.map((media) => (
                <CandidateCard
                  key={`${c.attempt.id}-${media.id}`}
                  attemptId={c.attempt.id}
                  mediaId={media.id}
                  url={media.cdnUrl ?? media.storageKey}
                  isConfirmed={media.isConfirmed}
                  aspectRatio={media.aspectRatio ?? '1:1'}
                  onOpenInfo={() => setInfoOpen({ attempt: c.attempt, media })}
                  onConfirm={() =>
                    confirmMut.mutate({
                      assetId: asset.id,
                      slot: selectedSlot,
                      mediaItemId: media.id,
                    })
                  }
                  onReject={() => rejectMut.mutate({ mediaItemId: media.id })}
                />
              )),
            )}
          </div>
        )}
      </div>

      {infoOpen && (
        <CandidateInfoDialog
          attempt={infoOpen.attempt}
          media={infoOpen.media}
          onClose={() => setInfoOpen(null)}
          onSameStyle={() => {
            const input = infoOpen.attempt.inputJson as Record<string, unknown>;
            generateMut.mutate({
              assetId: asset.id,
              slot: selectedSlot,
              count: 1,
              aspectRatio: (input.aspectRatio as string) ?? aspectRatio,
              extraInstruction: '(同款重新生成)',
            });
            setInfoOpen(null);
          }}
          onReject={() => {
            rejectMut.mutate({ mediaItemId: infoOpen.media.id });
            setInfoOpen(null);
          }}
        />
      )}
    </div>
  );
}

function CandidateCard({
  url,
  isConfirmed,
  aspectRatio,
  onOpenInfo,
  onConfirm,
  onReject,
}: {
  attemptId: string;
  mediaId: string;
  url: string | null;
  isConfirmed: boolean;
  aspectRatio: string;
  onOpenInfo: () => void;
  onConfirm: () => void;
  onReject: () => void;
}): React.ReactElement {
  const aspectClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16]'
      : aspectRatio === '16:9'
        ? 'aspect-[16/9]'
        : aspectRatio === '2:1'
          ? 'aspect-[2/1]'
          : 'aspect-square';
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded border',
        isConfirmed
          ? 'border-[hsl(var(--color-accent))]'
          : 'border-[hsl(var(--color-border))]',
      )}
    >
      <div
        onClick={onOpenInfo}
        className={cn(
          'relative flex cursor-pointer items-center justify-center bg-[hsl(var(--color-secondary)/0.3)]',
          aspectClass,
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <ImageIcon className="size-8 text-[hsl(var(--color-muted-foreground)/0.4)]" />
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white">
          {aspectRatio}
        </span>
        {isConfirmed && (
          <Badge variant="default" className="absolute right-1.5 top-1.5 gap-1 px-1.5 text-[9px]">
            <CheckCircle2 className="size-2.5" />
            已确认
          </Badge>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onConfirm}
          disabled={isConfirmed}
          className="flex-1 rounded bg-[hsl(var(--color-accent))] px-2 py-1 text-[10px] text-white disabled:opacity-40"
        >
          设为槽位
        </button>
        <button
          onClick={onReject}
          className="rounded bg-rose-500/80 px-2 py-1 text-[10px] text-white"
        >
          删除
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 右:已确认槽位
// ---------------------------------------------------------------------------

function ConfirmedSlotsPanel({
  asset,
  slots,
  onChanged,
}: {
  asset: AssetDetail;
  slots: Array<{ slot: Slot; label: string; aspectClass: string }>;
  onChanged: () => void;
}): React.ReactElement {
  const unconfirmMut = trpc.asset.unconfirmSlot.useMutation({
    onSuccess: () => {
      toast.success('已清除槽位');
      onChanged();
    },
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[hsl(var(--color-border))] px-4 py-3">
        <h3 className="text-sm font-semibold">已确认槽位</h3>
        <p className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
          下游 AIGC 调用以这里为准
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {slots.map((s) => {
          const fieldName = SLOT_FIELD[s.slot];
          const mediaId = (asset as unknown as Record<string, string | null>)[fieldName];
          return (
            <div key={s.slot}>
              <div className="mb-1 flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                  {s.label}
                </Label>
                {mediaId && (
                  <button
                    onClick={() => unconfirmMut.mutate({ assetId: asset.id, slot: s.slot })}
                    className="text-[9px] text-[hsl(var(--color-destructive))] hover:underline"
                  >
                    清除
                  </button>
                )}
              </div>
              <div
                className={cn(
                  'relative flex items-center justify-center overflow-hidden rounded border bg-[hsl(var(--color-secondary)/0.3)]',
                  s.aspectClass,
                  mediaId
                    ? 'border-[hsl(var(--color-accent)/0.5)]'
                    : 'border-dashed border-[hsl(var(--color-border))]',
                )}
              >
                {mediaId ? (
                  (() => {
                    const media = (asset as { mediaMap?: Record<string, { cdnUrl?: string | null; storageKey: string }> })
                      .mediaMap?.[mediaId];
                    const url = media?.cdnUrl ?? media?.storageKey;
                    return url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={s.label} className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        <CheckCircle2 className="size-5 text-[hsl(var(--color-accent))]" />
                        已确认
                      </div>
                    );
                  })()
                ) : (
                  <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">未确认</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 候选图 metadata 弹窗
// ---------------------------------------------------------------------------

function CandidateInfoDialog({
  attempt,
  media,
  onClose,
  onSameStyle,
  onReject,
}: {
  attempt: {
    id: string;
    providerId: string;
    modelId: string;
    inputJson: unknown;
    costCny: { toString: () => string } | string | number;
    durationMs: number | null;
    createdAt: Date;
    candidateForSlot: string | null;
  };
  media: { id: string; storageKey: string; cdnUrl: string | null; aspectRatio: string | null };
  onClose: () => void;
  onSameStyle: () => void;
  onReject: () => void;
}): React.ReactElement {
  const input = (attempt.inputJson ?? {}) as {
    prompt?: string;
    negative?: string;
    aspectRatio?: string;
    sizePx?: string;
    count?: number;
    parts?: {
      stylePart?: string;
      descriptionPart?: string;
      promptPart?: string;
      slotPart?: string;
      extraPart?: string;
    };
  };
  const url = media.cdnUrl ?? media.storageKey;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="grid max-h-[90vh] w-full max-w-3xl grid-cols-[1fr_320px] overflow-hidden rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 大图预览 */}
        <div className="flex items-center justify-center bg-black/40 p-3">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="max-h-[85vh] max-w-full object-contain" />
          ) : (
            <ImageIcon className="size-12 opacity-40" />
          )}
        </div>

        {/* 信息区 */}
        <div className="flex flex-col overflow-y-auto border-l border-[hsl(var(--color-border))]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-3">
            <h3 className="text-sm font-semibold">生成详情</h3>
            <button
              onClick={onClose}
              className="rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 p-4 text-xs">
            <KV label="模型" value={attempt.modelId} mono />
            <KV label="Provider" value={attempt.providerId} mono />
            <KV label="比例" value={input.aspectRatio ?? media.aspectRatio ?? '—'} mono />
            <KV label="尺寸" value={input.sizePx ?? '—'} mono />
            <KV label="槽位" value={attempt.candidateForSlot ?? '—'} mono />
            <KV
              label="生成时间"
              value={new Date(attempt.createdAt).toLocaleString()}
            />
            <KV
              label="耗时"
              value={attempt.durationMs ? `${attempt.durationMs} ms` : '—'}
            />
            <KV label="成本" value={`¥${String(attempt.costCny)}`} />

            <div className="grid gap-1 border-t border-[hsl(var(--color-border)/0.5)] pt-2">
              <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                完整提示词
              </Label>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-[hsl(var(--color-secondary)/0.4)] p-2 font-mono text-[10px] leading-relaxed">
                {input.prompt ?? '—'}
              </pre>
            </div>

            {input.negative && (
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                  负面提示词
                </Label>
                <pre className="rounded bg-[hsl(var(--color-secondary)/0.4)] p-2 font-mono text-[10px] leading-relaxed">
                  {input.negative}
                </pre>
              </div>
            )}

            {input.parts && (
              <details className="text-[10px]">
                <summary className="cursor-pointer text-[hsl(var(--color-muted-foreground))]">
                  prompt 拼接组成
                </summary>
                <div className="mt-1 space-y-1 rounded bg-[hsl(var(--color-secondary)/0.3)] p-2">
                  {input.parts.stylePart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[风格]</span>{' '}
                      {input.parts.stylePart}
                    </div>
                  )}
                  {input.parts.descriptionPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[描述]</span>{' '}
                      {input.parts.descriptionPart}
                    </div>
                  )}
                  {input.parts.promptPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[资产]</span>{' '}
                      {input.parts.promptPart}
                    </div>
                  )}
                  {input.parts.slotPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[槽位]</span>{' '}
                      {input.parts.slotPart}
                    </div>
                  )}
                  {input.parts.extraPart && (
                    <div>
                      <span className="text-[hsl(var(--color-muted-foreground))]">[额外]</span>{' '}
                      {input.parts.extraPart}
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>

          <div className="flex gap-2 border-t border-[hsl(var(--color-border))] p-3">
            <Button onClick={onSameStyle} size="sm" variant="outline" className="flex-1 gap-1.5">
              <Sparkles className="size-3.5" />
              同款再生成
            </Button>
            <Button onClick={onReject} size="sm" variant="destructive" className="gap-1.5">
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
        {label}
      </span>
      <span className={cn('text-[11px]', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 出场绑定 list(放在左信息区)
// ---------------------------------------------------------------------------

function UsageBindingsList({
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
