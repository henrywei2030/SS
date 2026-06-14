'use client';
import * as React from 'react';
import {
  Loader2,
  Trash2,
  Lock,
  Unlock,
  CheckCircle2,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
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
import { AutoGrowTextarea } from '@/components/auto-grow-textarea';

import { type AssetDetail, type AssetType, CHARACTER_ROLES } from './asset-edit-shared';
import { VoiceField } from './asset-edit-voice-field';
import { UsageBindingsList } from './asset-edit-usage-bindings';

// ---------------------------------------------------------------------------
// 左:信息区
// ---------------------------------------------------------------------------

export function InfoPanel({
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
  const { confirm, confirmDialog } = useConfirm();

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
    <>
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
            onClick={() =>
              confirm({
                title: `删除资产 "${asset.name}"?`,
                danger: true,
                confirmLabel: '删除',
                onConfirm: () => deleteMut.mutate({ assetId: asset.id }),
              })
            }
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
          <AutoGrowTextarea
            value={editing.description}
            onChange={(v) => setEditing({ ...editing, description: v })}
            disabled={isLocked}
            minRows={2}
            className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs leading-relaxed"
          />
        </div>

        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            提示词
          </Label>
          <AutoGrowTextarea
            value={editing.prompt}
            onChange={(v) => setEditing({ ...editing, prompt: v })}
            disabled={isLocked}
            minRows={4}
            className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 font-mono text-[11px] leading-relaxed"
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
              <AutoGrowTextarea
                value={editing.monologue}
                onChange={(v) => setEditing({ ...editing, monologue: v.slice(0, 2000) })}
                minRows={2}
                className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs leading-relaxed"
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

            {/* 五七-3:参考音频(配音参考)— 视频生成时绑该角色自动带上 */}
            <VoiceField
              assetId={asset.id}
              projectId={asset.projectId}
              voiceMediaId={asset.voiceMediaId}
              onChanged={onChanged}
            />
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
    {confirmDialog}
    </>
  );
}
