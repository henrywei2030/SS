'use client';

/**
 * 五六-2 · 剧本拆解 pane(重写为图2 三板块布局)
 *
 * 定位:由后端 LLM 从「关联的完整剧本」拆解 + 打磨 人物/场景/道具 的文字设定,
 *   人工再微调,完成后可选「同步到美术工坊」。不是手动建资产。
 *
 * 布局:顶栏(从完整剧本拆解 + 同步全部)+ 三并排板块(人物/场景/道具)。
 *   每板块 = 左「选择列表」(名称 + role + … 菜单 + 内联 + 新建)| 右「设定内容」编辑器。
 *   人物:基础 + 形象设定 + 人物小传 + 心理(每段「AI 生成」);场景/道具:设定描述 + 生图提示词。
 *
 * 架构:全部文字由后端模型生成(breakdownProject 整本拆 / generateAssetText 定点重生成 /
 *   generateProfileField 心理字段),同一份 Asset,syncToArt 闸只翻转不复制。
 */
import * as React from 'react';
import {
  Loader2,
  Plus,
  Send,
  Trash2,
  Wand2,
  CheckCircle2,
  Circle,
  CircleUser,
  MapPin,
  Package as PackageIcon,
  MoreHorizontal,
  ScanText,
} from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  GENDER_LABEL,
  LifeNodesEditor,
  parseProfileJson,
  buildProfileJson,
  type Gender,
  type LifeNode,
} from '@/components/asset-profile-fields';
import { cn } from '@/lib/utils';
import { AutoGrowTextarea } from '@/components/auto-grow-textarea';

import { BreakdownReviewDialog } from './breakdown-review-dialog';

type AssetType = 'CHARACTER' | 'SCENE' | 'PROP';
type AssetItem = inferRouterOutputs<AppRouter>['asset']['list']['assets'][number];

const TYPES: Array<{ type: AssetType; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { type: 'CHARACTER', label: '人物设定', icon: CircleUser },
  { type: 'SCENE', label: '场景设定', icon: MapPin },
  { type: 'PROP', label: '道具设定', icon: PackageIcon },
];

const CHARACTER_ROLES = [
  '主演-男主',
  '主演-女主',
  '主演-反派',
  '配角-正派',
  '配角-反派',
  '配角-中性',
  '群演',
] as const;

// 五七-3:排序 + 出场集 helpers
//   人物按重要性(主演>配角>群演)再按首次出场集;场景/道具按首次出场集
const ROLE_RANK: Record<string, number> = {
  '主演-男主': 0,
  '主演-女主': 0,
  '主演-反派': 0,
  '配角-正派': 1,
  '配角-反派': 1,
  '配角-中性': 1,
  群演: 2,
};
function firstEpisode(a: { episodes?: number[] | null }): number {
  return a.episodes && a.episodes.length > 0 ? Math.min(...a.episodes) : 99999;
}
function roleShort(role?: string | null): string {
  if (!role) return '';
  if (role.startsWith('主演')) return '主演';
  if (role.startsWith('配角')) return '配角';
  return role; // 群演
}
function episodesLabel(eps?: number[] | null): string {
  if (!eps || eps.length === 0) return '';
  return [...eps].sort((x, y) => x - y).join('·');
}
function sortBreakdownAssets(list: AssetItem[], type: AssetType): AssetItem[] {
  return [...list].sort((a, b) => {
    if (type === 'CHARACTER') {
      const ra = ROLE_RANK[a.characterRole ?? ''] ?? 3;
      const rb = ROLE_RANK[b.characterRole ?? ''] ?? 3;
      if (ra !== rb) return ra - rb;
    }
    const fa = firstEpisode(a);
    const fb = firstEpisode(b);
    if (fa !== fb) return fa - fb;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function ScriptBreakdownPane({ projectId }: { projectId: string }): React.ReactElement {
  const utils = trpc.useUtils();
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const syncAll = trpc.asset.syncToArt.useMutation({
    onSuccess: (res) => {
      toast[res.syncedCount === 0 ? 'info' : 'success'](
        res.syncedCount === 0 ? '没有可同步的新设定(全部已同步)' : `已同步 ${res.syncedCount} 个资产到美术工坊`,
      );
      void utils.asset.list.invalidate();
    },
    onError: (e) => toast.error(`同步失败:${e.message}`),
  });
  const [syncConfirm, setSyncConfirm] = React.useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[hsl(var(--color-border))] px-3">
        <div className="text-[12px] text-[hsl(var(--color-muted-foreground))]">
          由模型从「完整剧本」拆解人物/场景/道具文字设定 · 人工微调后同步美术工坊
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="default" className="h-7 gap-1.5 text-xs" onClick={() => setReviewOpen(true)}>
            <ScanText className="size-3.5" />
            从完整剧本拆解
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setSyncConfirm(true)}
            disabled={syncAll.isPending}
            title="把所有「未同步」设定标记同步到美术工坊(只翻转闸,不覆盖)"
          >
            {syncAll.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            同步全部
          </Button>
        </div>
      </div>

      {/* 三板块 */}
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 overflow-hidden p-3">
        {TYPES.map((t) => (
          <TypePanel key={t.type} projectId={projectId} type={t.type} label={t.label} Icon={t.icon} />
        ))}
      </div>

      {reviewOpen && (
        <BreakdownReviewDialog
          projectId={projectId}
          onClose={() => setReviewOpen(false)}
          onApplied={() => {
            setReviewOpen(false);
            void utils.asset.list.invalidate();
          }}
        />
      )}
      {syncConfirm && (
        <ConfirmDialog
          title="同步全部设定到美术工坊?"
          description="把本项目所有「未同步」资产标记为已同步。已同步的不会被覆盖(保证美术侧改动永不丢失)。"
          confirmLabel="同步"
          onClose={() => setSyncConfirm(false)}
          onConfirm={() => {
            syncAll.mutate({ projectId });
            setSyncConfirm(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 单类型板块:左选择列表 + 右设定内容
// ---------------------------------------------------------------------------

function TypePanel({
  projectId,
  type,
  label,
  Icon,
}: {
  projectId: string;
  type: AssetType;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}): React.ReactElement {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.asset.list.useQuery({ projectId, type });
  const assets = React.useMemo(() => data?.assets ?? [], [data]);
  // 五七-3:人物按重要性+首次出场排,场景/道具按首次出场排
  const sortedAssets = React.useMemo(() => sortBreakdownAssets(assets, type), [assets, type]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState('');

  // 选中项不在列表里(切换/删除后)→ 清空
  React.useEffect(() => {
    if (selectedId && !assets.find((a) => a.id === selectedId)) setSelectedId(null);
  }, [assets, selectedId]);

  const withContent = assets.filter((a) => (a.description ?? '').trim().length > 0).length;

  const create = trpc.asset.create.useMutation({
    onSuccess: (res) => {
      toast.success(`已新建「${res.name}」`);
      setAdding(false);
      setNewName('');
      setSelectedId(res.id);
      void utils.asset.list.invalidate({ projectId, type });
    },
    onError: (e) => toast.error(`新建失败:${e.message}`),
  });

  const submitNew = (): void => {
    const name = newName.trim();
    if (!name) return;
    create.mutate({ projectId, type, name, prompt: '(待补)', alias: [], description: '', tags: [] });
  };

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[hsl(var(--color-border))]">
      {/* 板块标题 */}
      <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary)/0.3)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-[hsl(var(--color-accent))]">
          <Icon className="size-3.5" />
          {label}
        </div>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {withContent}/{assets.length}
        </Badge>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[112px_1fr]">
        {/* 左:选择列表 */}
        <div className="flex min-h-0 flex-col border-r border-[hsl(var(--color-border))]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-2 py-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
              {TYPES.find((t) => t.type === type)?.label.replace('设定', '')}选择
            </span>
            <button
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--color-accent))] hover:underline"
              title="新建(最小占位,内容靠拆解/AI 填)"
            >
              <Plus className="size-2.5" />
              新建
            </button>
          </div>
          {adding && (
            <div className="border-b border-[hsl(var(--color-border))] p-1.5">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value.slice(0, 100))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNew();
                  else if (e.key === 'Escape') {
                    setAdding(false);
                    setNewName('');
                  }
                }}
                placeholder="名称↵"
                className="h-6 text-[11px]"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center gap-1 p-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                <Loader2 className="size-3 animate-spin" />
              </div>
            ) : assets.length === 0 ? (
              <div className="p-2 text-[10px] leading-relaxed text-[hsl(var(--color-muted-foreground))]">
                暂无 · 点上方「从完整剧本拆解」
              </div>
            ) : (
              <ul>
                {sortedAssets.map((a) => {
                  const eps = episodesLabel(a.episodes);
                  const meta = [
                    type === 'CHARACTER' ? roleShort(a.characterRole) : '',
                    eps ? `第${eps}集` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <li key={a.id}>
                      <button
                        onClick={() => setSelectedId(a.id)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors',
                          selectedId === a.id
                            ? 'bg-[hsl(var(--color-accent)/0.1)]'
                            : 'hover:bg-[hsl(var(--color-secondary)/0.5)]',
                        )}
                      >
                        <span className="flex items-center gap-1">
                          <span className="flex-1 truncate text-[11px]" title={a.name}>
                            {a.name}
                          </span>
                          {a.syncedToArtAt ? (
                            <CheckCircle2 className="size-2.5 shrink-0 text-[hsl(var(--color-success))]" />
                          ) : (
                            <Circle className="size-2.5 shrink-0 text-[hsl(var(--color-muted-foreground)/0.5)]" />
                          )}
                        </span>
                        {meta && (
                          <span
                            className="truncate text-[9px] text-[hsl(var(--color-muted-foreground))]"
                            title={meta}
                          >
                            {meta}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* 右:设定内容 */}
        <div className="min-h-0 overflow-y-auto">
          {selectedId ? (
            <SettingEditor
              key={selectedId}
              assetId={selectedId}
              projectId={projectId}
              type={type}
              onDeleted={() => {
                setSelectedId(null);
                void utils.asset.list.invalidate({ projectId, type });
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-4 text-center">
              <ScanText className="mb-2 size-8 text-[hsl(var(--color-muted-foreground)/0.3)]" />
              <p className="text-[11px] text-[hsl(var(--color-muted-foreground))]">请选择左侧条目</p>
              <p className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground)/0.7)]">查看或编辑设定</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 设定内容编辑器
// ---------------------------------------------------------------------------

function SettingEditor({
  assetId,
  projectId: _projectId,
  type,
  onDeleted,
}: {
  assetId: string;
  projectId: string;
  type: AssetType;
  onDeleted: () => void;
}): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: asset, isLoading } = trpc.asset.get.useQuery({ assetId });
  const isChar = type === 'CHARACTER';

  const [form, setForm] = React.useState<{
    name: string;
    characterRole: string;
    gender: Gender | '';
    age: string;
    heightCm: string;
    description: string;
    prompt: string;
    bio: string;
    mbti: string;
    personalityTags: string[];
    monologue: string;
    lifeNodes: LifeNode[];
    voiceLabel: string;
    episodes: string; // 五七-3:逗号分隔集号,保存时转 number[]
  } | null>(null);

  React.useEffect(() => {
    if (!asset) {
      setForm(null);
      return;
    }
    const p = parseProfileJson(asset.profileJson);
    setForm({
      name: asset.name ?? '',
      characterRole: (asset.characterRole as string | null) ?? '',
      gender: (asset.gender as Gender | null) ?? '',
      age: asset.age == null ? '' : String(asset.age),
      heightCm: asset.heightCm == null ? '' : String(asset.heightCm),
      description: asset.description ?? '',
      prompt: asset.prompt ?? '',
      bio: asset.bio ?? '',
      mbti: asset.mbti ?? '',
      personalityTags: Array.isArray(asset.personalityTags) ? [...asset.personalityTags] : [],
      monologue: asset.monologue ?? '',
      lifeNodes: p.lifeNodes,
      voiceLabel: p.voiceLabel,
      episodes: (asset.episodes ?? []).join(', '),
    });
  }, [asset]);

  const update = trpc.asset.update.useMutation({
    onSuccess: () => {
      toast.success('已保存');
      void utils.asset.get.invalidate({ assetId });
      void utils.asset.list.invalidate();
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });
  const del = trpc.asset.delete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      onDeleted();
    },
    onError: (e) => toast.error(`删除失败:${e.message}`),
  });
  const syncOne = trpc.asset.syncToArt.useMutation({
    onSuccess: (res) => {
      toast[res.syncedCount === 0 ? 'info' : 'success'](
        res.syncedCount === 0 ? '已是同步状态' : '已同步到美术工坊',
      );
      void utils.asset.get.invalidate({ assetId });
      void utils.asset.list.invalidate();
    },
    onError: (e) => toast.error(`同步失败:${e.message}`),
  });
  const genText = trpc.asset.generateAssetText.useMutation();
  const genProfile = trpc.asset.generateProfileField.useMutation();

  const [confirmDelete, setConfirmDelete] = React.useState(false);

  if (isLoading || !asset || !form) {
    return (
      <div className="flex items-center gap-1.5 p-3 text-[11px] text-[hsl(var(--color-muted-foreground))]">
        <Loader2 className="size-3 animate-spin" /> 加载…
      </div>
    );
  }

  const save = (): void => {
    // 五七-3:出场集 string → number[](去重升序)
    const parsedEpisodes = Array.from(
      new Set(
        form.episodes
          .split(/[,，、\s]+/)
          .map((s) => parseInt(s, 10))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ).sort((a, b) => a - b);
    update.mutate({
      assetId,
      patch: {
        name: form.name,
        episodes: parsedEpisodes,
        characterRole: isChar ? (form.characterRole === '' ? null : (form.characterRole as never)) : undefined,
        gender: isChar ? (form.gender === '' ? null : form.gender) : undefined,
        age: isChar ? (form.age === '' ? null : Number(form.age)) : undefined,
        heightCm: isChar ? (form.heightCm === '' ? null : Number(form.heightCm)) : undefined,
        description: form.description,
        prompt: form.prompt || '(待补)',
        bio: isChar ? (form.bio === '' ? null : form.bio) : undefined,
        mbti: isChar ? (form.mbti === '' ? null : form.mbti) : undefined,
        personalityTags: isChar ? form.personalityTags : undefined,
        monologue: isChar ? (form.monologue === '' ? null : form.monologue) : undefined,
        profileJson: isChar ? buildProfileJson(form.lifeNodes, form.voiceLabel) : undefined,
      },
    });
  };

  // 定点重生成(description/prompt/bio,带完整剧本上下文)
  const aiText = async (field: 'description' | 'prompt' | 'bio'): Promise<void> => {
    try {
      const res = await genText.mutateAsync({ assetId, field });
      setForm((prev) => (prev ? { ...prev, [field]: res.value } : prev));
      toast.success('已生成草案,请审阅后保存');
    } catch (e) {
      toast.error(`生成失败:${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // 心理字段(mbti/personalityTags/monologue/lifeNodes)
  const aiProfile = async (field: 'mbti' | 'personalityTags' | 'monologue' | 'lifeNodes'): Promise<void> => {
    try {
      const res = await genProfile.mutateAsync({ assetId, field });
      if (res.warning) toast.warning(res.warning);
      setForm((prev) => {
        if (!prev) return prev;
        if (field === 'mbti' && typeof res.value === 'string') return { ...prev, mbti: res.value };
        if (field === 'monologue' && typeof res.value === 'string') return { ...prev, monologue: res.value };
        if (field === 'personalityTags' && Array.isArray(res.value))
          return { ...prev, personalityTags: (res.value as unknown[]).filter((t): t is string => typeof t === 'string') };
        if (field === 'lifeNodes' && Array.isArray(res.value))
          return { ...prev, lifeNodes: res.value as LifeNode[] };
        return prev;
      });
      toast.success('已生成草案,请审阅后保存');
    } catch (e) {
      toast.error(`生成失败:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const genField = genText.variables?.field;
  const inputCls =
    'w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1 text-[11px]';

  return (
    <div className="space-y-2.5 p-2.5">
      {/* 头:同步状态 + … 菜单 */}
      <div className="flex items-center justify-between">
        {asset.syncedToArtAt ? (
          <Badge variant="outline" className="border-[hsl(var(--color-success))]/30 px-1 text-[9px] text-[hsl(var(--color-success))]">
            <CheckCircle2 className="mr-0.5 size-2.5" />
            已同步
          </Badge>
        ) : (
          <Badge variant="outline" className="px-1 text-[9px]">
            未同步
          </Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded p-0.5 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]">
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => syncOne.mutate({ projectId: asset.projectId, assetIds: [assetId] })}>
              <Send className="mr-2 size-3.5" />
              同步到美术工坊
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setConfirmDelete(true)}
              className="text-[hsl(var(--color-destructive))]"
            >
              <Trash2 className="mr-2 size-3.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 名称 */}
      <FieldText label="名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} rows={1} />

      {/* 五七-3:出场集(排序 + 标注用)*/}
      <FieldText
        label="出场集(逗号分隔集号)"
        value={form.episodes}
        onChange={(v) => setForm({ ...form, episodes: v })}
        rows={1}
      />

      {/* 人物基础 */}
      {isChar && (
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label>角色定位</Label>
            <select
              className={inputCls}
              value={form.characterRole}
              onChange={(e) => setForm({ ...form, characterRole: e.target.value })}
            >
              <option value="">—</option>
              {CHARACTER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>性别</Label>
            <select
              className={inputCls}
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value as Gender | '' })}
            >
              <option value="">—</option>
              {(['MALE', 'FEMALE', 'OTHER'] as const).map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>年龄</Label>
            <input type="number" className={inputCls} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
          </div>
          <div>
            <Label>身高cm</Label>
            <input type="number" className={inputCls} value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} />
          </div>
        </div>
      )}

      {/* 形象设定 / 设定描述 */}
      <FieldText
        label={isChar ? '形象设定(生图视觉锚)' : '设定描述(利于生图)'}
        value={form.description}
        onChange={(v) => setForm({ ...form, description: v })}
        rows={4}
        onAI={() => void aiText('description')}
        aiLoading={genText.isPending && genField === 'description'}
      />

      {/* 人物小传 */}
      {isChar && (
        <FieldText
          label="人物小传(背景/动机/弧光)"
          value={form.bio}
          onChange={(v) => setForm({ ...form, bio: v })}
          rows={5}
          onAI={() => void aiText('bio')}
          aiLoading={genText.isPending && genField === 'bio'}
        />
      )}

      {/* 生图提示词 */}
      <FieldText
        label="生图提示词"
        value={form.prompt}
        onChange={(v) => setForm({ ...form, prompt: v })}
        rows={3}
        mono
        onAI={() => void aiText('prompt')}
        aiLoading={genText.isPending && genField === 'prompt'}
      />

      {/* 人物心理(折叠) */}
      {isChar && (
        <details className="rounded border border-[hsl(var(--color-border)/0.6)] p-1.5">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
            心理 / 深度设定
          </summary>
          <div className="mt-1.5 space-y-2">
            <FieldWrap label="MBTI" onAI={() => void aiProfile('mbti')} aiLoading={genProfile.isPending && genProfile.variables?.field === 'mbti'}>
              <input
                className={cn(inputCls, 'font-mono uppercase')}
                value={form.mbti}
                onChange={(e) => setForm({ ...form, mbti: e.target.value.toUpperCase().slice(0, 8) })}
                placeholder="INTJ"
              />
            </FieldWrap>
            <FieldWrap
              label="性格标签(逗号分隔)"
              onAI={() => void aiProfile('personalityTags')}
              aiLoading={genProfile.isPending && genProfile.variables?.field === 'personalityTags'}
            >
              <input
                className={inputCls}
                value={form.personalityTags.join(',')}
                onChange={(e) =>
                  setForm({
                    ...form,
                    personalityTags: e.target.value
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .slice(0, 20),
                  })
                }
                placeholder="冷静, 强势"
              />
            </FieldWrap>
            <FieldWrap label="内心独白" onAI={() => void aiProfile('monologue')} aiLoading={genProfile.isPending && genProfile.variables?.field === 'monologue'}>
              <textarea
                className={cn(inputCls, 'min-h-[40px] resize-y')}
                value={form.monologue}
                onChange={(e) => setForm({ ...form, monologue: e.target.value.slice(0, 2000) })}
              />
            </FieldWrap>
            <FieldWrap label="人生节点" onAI={() => void aiProfile('lifeNodes')} aiLoading={genProfile.isPending && genProfile.variables?.field === 'lifeNodes'}>
              <LifeNodesEditor nodes={form.lifeNodes} onChange={(nodes) => setForm({ ...form, lifeNodes: nodes })} />
            </FieldWrap>
          </div>
        </details>
      )}

      {/* 保存 */}
      <div className="sticky bottom-0 -mx-2.5 flex justify-end gap-1.5 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2.5 py-1.5">
        <Button size="sm" className="h-7 gap-1 text-xs" onClick={save} disabled={update.isPending}>
          {update.isPending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
          保存
        </Button>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`删除「${asset.name}」?`}
          description="软删 · 关联绑定一起标删,不影响已生成内容。"
          confirmLabel="删除"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            del.mutate({ assetId });
            setConfirmDelete(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 小组件
// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }): React.ReactElement {
  return <label className="mb-0.5 block text-[10px] text-[hsl(var(--color-muted-foreground))]">{children}</label>;
}

function FieldWrap({
  label,
  onAI,
  aiLoading,
  children,
}: {
  label: string;
  onAI?: () => void;
  aiLoading?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">{label}</label>
        {onAI && (
          <button
            type="button"
            onClick={onAI}
            disabled={aiLoading}
            className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--color-accent))] hover:underline disabled:opacity-50"
            title="后端模型生成草案,审阅后保存"
          >
            {aiLoading ? <Loader2 className="size-2.5 animate-spin" /> : <Wand2 className="size-2.5" />}
            AI 生成
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
  rows,
  mono,
  onAI,
  aiLoading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  mono?: boolean;
  onAI?: () => void;
  aiLoading?: boolean;
}): React.ReactElement {
  const cls =
    'w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1 text-[11px]';
  return (
    <FieldWrap label={label} onAI={onAI} aiLoading={aiLoading}>
      {rows <= 1 ? (
        <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <AutoGrowTextarea
          value={value}
          onChange={onChange}
          minRows={rows}
          className={cn(
            'w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1 text-[11px] leading-relaxed',
            mono && 'font-mono',
          )}
        />
      )}
    </FieldWrap>
  );
}
