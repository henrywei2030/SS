'use client';

/**
 * 五六收工 · 剧本拆解 pane(P2 前端落地 P1 后端 — Asset 文字档案 / AssetRelation / syncToArt 闸)
 *
 * 三栏文字界面:
 *   - 左 260px:资产列表(类型分组 · syncFilter 视图切换 · 新建)
 *   - 中 flex:选中资产的档案编辑(基础 + 档案字段 + 「AI 生成」逐项)
 *   - 右 320px:关联列表(listRelations + createRelation/delete)+ 同步到美术工坊
 *
 * 架构定论(五五收工):
 *   - 剧本拆解 = 纯文字定稿(导演侧),美术工坊 = 图(美术侧)
 *   - 同步只翻转闸(syncedToArtAt),不复制数据 → 已同步资产美术侧改动永不被覆盖
 *   - profileJson 是整体覆盖语义,前端必须读-改-写全量(否则丢字段)
 */
import * as React from 'react';
import {
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  CircleUser,
  MapPin,
  Package as PackageIcon,
  Link2,
  X,
  Send,
  Wand2,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { toast } from 'sonner';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

// ---------------------------------------------------------------------------
// 类型(从 router output 推)
// ---------------------------------------------------------------------------

type AssetListResult = inferRouterOutputs<AppRouter>['asset']['list'];
type AssetItem = AssetListResult['assets'][number];

type AssetType = 'CHARACTER' | 'SCENE' | 'PROP';
type SyncFilter = 'all' | 'synced' | 'unsynced';
// Gender / LifeNode / GENDER_LABEL / LifeNodesEditor 抽到 @/components/asset-profile-fields(与美术工坊共享)

const TYPE_LABEL: Record<AssetType, string> = {
  CHARACTER: '人物',
  SCENE: '场景',
  PROP: '道具',
};

const TYPE_ICON: Record<AssetType, React.ComponentType<{ className?: string }>> = {
  CHARACTER: CircleUser,
  SCENE: MapPin,
  PROP: PackageIcon,
};

const SYNC_LABEL: Record<SyncFilter, string> = {
  all: '全部',
  unsynced: '未同步',
  synced: '已同步',
};

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function ScriptBreakdownPane({
  projectId,
}: {
  projectId: string;
}): React.ReactElement {
  const [selectedType, setSelectedType] = React.useState<AssetType>('CHARACTER');
  const [syncFilter, setSyncFilter] = React.useState<SyncFilter>('all');
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | null>(null);
  const [newAssetOpen, setNewAssetOpen] = React.useState(false);

  const utils = trpc.useUtils();
  const { data: listData, isLoading } = trpc.asset.list.useQuery({
    projectId,
    type: selectedType,
    syncFilter,
  });

  // 项目内全资产(关联用 — 不带类型过滤,可关联到任意类型)
  const { data: allListData } = trpc.asset.list.useQuery({
    projectId,
    syncFilter: 'all',
  });

  const assets = listData?.assets ?? [];

  // 切类型或刷新时,选中项不在新列表里则清空
  React.useEffect(() => {
    if (selectedAssetId && !assets.find((a) => a.id === selectedAssetId)) {
      setSelectedAssetId(null);
    }
  }, [assets, selectedAssetId]);

  const syncAll = trpc.asset.syncToArt.useMutation({
    onSuccess: (res) => {
      if (res.syncedCount === 0) {
        toast.info('没有可同步的新资产(全部已同步过)');
      } else {
        toast.success(`已同步 ${res.syncedCount} 个资产到美术工坊`);
      }
      void utils.asset.list.invalidate();
    },
    onError: (e) => toast.error(`同步失败:${e.message}`),
  });

  const [syncAllConfirmOpen, setSyncAllConfirmOpen] = React.useState(false);

  return (
    <div className="grid h-full grid-cols-[260px_1fr_320px] gap-0 overflow-hidden">
      {/* 左栏:资产列表 */}
      <div className="flex h-full min-h-0 flex-col border-r border-[hsl(var(--color-border))]">
        {/* 类型 tab */}
        <div className="flex border-b border-[hsl(var(--color-border))]">
          {(['CHARACTER', 'SCENE', 'PROP'] as const).map((t) => {
            const Icon = TYPE_ICON[t];
            return (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 py-2 text-[12px] transition-colors',
                  selectedType === t
                    ? 'border-b-2 border-[hsl(var(--color-accent))] text-[hsl(var(--color-foreground))]'
                    : 'border-b-2 border-transparent text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]',
                )}
              >
                <Icon className="size-3.5" />
                {TYPE_LABEL[t]}
              </button>
            );
          })}
        </div>

        {/* 视图切换 */}
        <div className="flex items-center justify-between gap-1 border-b border-[hsl(var(--color-border))] px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {(['all', 'unsynced', 'synced'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setSyncFilter(v)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  syncFilter === v
                    ? 'bg-[hsl(var(--color-accent)/0.12)] text-[hsl(var(--color-accent))]'
                    : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
                )}
              >
                {SYNC_LABEL[v]}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[11px]"
            onClick={() => setNewAssetOpen(true)}
            title="新建资产"
          >
            <Plus className="size-3" />
          </Button>
        </div>

        {/* 资产列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 p-3 text-[11px] text-[hsl(var(--color-muted-foreground))]">
              <Loader2 className="size-3 animate-spin" /> 加载…
            </div>
          ) : assets.length === 0 ? (
            <div className="p-3 text-center text-[11px] text-[hsl(var(--color-muted-foreground))]">
              {syncFilter === 'all'
                ? '暂无资产 · 点 + 新建,或在剧本管理用「批量拆解」'
                : `${SYNC_LABEL[syncFilter]} 的资产为空`}
            </div>
          ) : (
            <ul className="divide-y divide-[hsl(var(--color-border))]">
              {assets.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setSelectedAssetId(a.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors',
                      selectedAssetId === a.id
                        ? 'bg-[hsl(var(--color-accent)/0.08)]'
                        : 'hover:bg-[hsl(var(--color-secondary)/0.5)]',
                    )}
                  >
                    <span className="flex-1 truncate text-[12px]">{a.name}</span>
                    {a.syncedToArtAt ? (
                      <CheckCircle2
                        className="size-3 text-[hsl(var(--color-success))]"
                        aria-label="已同步美术工坊"
                      />
                    ) : (
                      <Circle
                        className="size-3 text-[hsl(var(--color-muted-foreground))]"
                        aria-label="未同步"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部:同步全部 */}
        <div className="border-t border-[hsl(var(--color-border))] p-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1 text-[11px]"
            onClick={() => setSyncAllConfirmOpen(true)}
            disabled={syncAll.isPending}
            title="把本项目「未同步」的资产标记到美术工坊(只翻转闸,不覆盖)"
          >
            {syncAll.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Send className="size-3" />
            )}
            同步全部到美术工坊
          </Button>
        </div>
      </div>

      {/* 中栏:档案编辑 */}
      <div className="min-h-0 overflow-y-auto">
        {selectedAssetId ? (
          <AssetProfileEditor
            key={selectedAssetId}
            assetId={selectedAssetId}
            projectId={projectId}
            onDeleted={() => {
              setSelectedAssetId(null);
              void utils.asset.list.invalidate();
            }}
          />
        ) : (
          <EmptyDetailState />
        )}
      </div>

      {/* 右栏:关联 */}
      <div className="min-h-0 border-l border-[hsl(var(--color-border))]">
        {selectedAssetId ? (
          <RelationsPanel
            assetId={selectedAssetId}
            projectId={projectId}
            allAssets={allListData?.assets ?? []}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-[hsl(var(--color-muted-foreground))]">
            选中资产查看关联
          </div>
        )}
      </div>

      {/* 新建资产 dialog */}
      <NewAssetDialog
        open={newAssetOpen}
        onOpenChange={setNewAssetOpen}
        projectId={projectId}
        defaultType={selectedType}
        onCreated={(id) => {
          setSelectedAssetId(id);
          void utils.asset.list.invalidate();
        }}
      />

      {/* 同步确认 — ConfirmDialog 是父级条件渲染式 API(无 open/onOpenChange) */}
      {syncAllConfirmOpen && (
        <ConfirmDialog
          title="同步全部资产到美术工坊?"
          description="把本项目所有「未同步」资产标记为已同步美术工坊。已同步的资产不会重新覆盖(保证美术侧改动永不丢失)。"
          confirmLabel="同步"
          onClose={() => setSyncAllConfirmOpen(false)}
          onConfirm={() => {
            syncAll.mutate({ projectId });
            setSyncAllConfirmOpen(false);
          }}
        />
      )}
    </div>
  );
}

function EmptyDetailState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="max-w-md text-center text-[12px] text-[hsl(var(--color-muted-foreground))]">
        <p className="mb-2 text-[13px] font-medium text-[hsl(var(--color-foreground))]">
          剧本拆解 · 文字定稿
        </p>
        <p>从左栏选一个资产开始编辑档案。</p>
        <p className="mt-1">
          这里只录文字(姓名 / 角色定位 / 性格 / 独白 / 人生节点),
          美术工坊负责生图。
        </p>
        <p className="mt-1">
          完成后点「同步到美术工坊」翻转闸,资产即对美术侧可见(同步只翻转闸,不复制数据)。
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 中栏:档案编辑器(load 单个 asset + edit + save)
// ---------------------------------------------------------------------------

function AssetProfileEditor({
  assetId,
  projectId: _projectId,
  onDeleted,
}: {
  assetId: string;
  projectId: string;
  onDeleted: () => void;
}): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: asset, isLoading } = trpc.asset.get.useQuery({ assetId });

  // 表单本地态(初始化用 server 拉来的值;asset 变化时 reset)
  const [form, setForm] = React.useState<{
    name: string;
    characterRole: string;
    description: string;
    prompt: string;
    gender: Gender | '';
    age: string; // 用 string 便于空值,保存时转 number
    heightCm: string;
    mbti: string;
    personalityTags: string[];
    monologue: string;
    lifeNodes: LifeNode[];
    voiceLabel: string;
  } | null>(null);

  React.useEffect(() => {
    if (!asset) {
      setForm(null);
      return;
    }
    const profile = parseProfileJson(asset.profileJson);
    setForm({
      name: asset.name ?? '',
      characterRole: (asset.characterRole as string | null) ?? '',
      description: asset.description ?? '',
      prompt: asset.prompt ?? '',
      gender: (asset.gender as Gender | null) ?? '',
      age: asset.age == null ? '' : String(asset.age),
      heightCm: asset.heightCm == null ? '' : String(asset.heightCm),
      mbti: asset.mbti ?? '',
      personalityTags: Array.isArray(asset.personalityTags) ? [...asset.personalityTags] : [],
      monologue: asset.monologue ?? '',
      lifeNodes: profile.lifeNodes,
      voiceLabel: profile.voiceLabel,
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

  const generate = trpc.asset.generateProfileField.useMutation();

  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  if (isLoading || !asset || !form) {
    return (
      <div className="flex items-center gap-2 p-4 text-[12px] text-[hsl(var(--color-muted-foreground))]">
        <Loader2 className="size-3 animate-spin" /> 加载档案…
      </div>
    );
  }

  const save = (): void => {
    // 把 string-age / string-height 转数字(空字符串 = null = 清除);profileJson 整体覆盖
    const profileJson = buildProfileJson(form.lifeNodes, form.voiceLabel);
    update.mutate({
      assetId,
      patch: {
        name: form.name,
        characterRole:
          form.characterRole === ''
            ? null
            : (form.characterRole as
                | '主演-男主'
                | '主演-女主'
                | '主演-反派'
                | '配角-正派'
                | '配角-反派'
                | '配角-中性'
                | '群演'),
        description: form.description,
        prompt: form.prompt,
        gender: form.gender === '' ? null : form.gender,
        age: form.age === '' ? null : Number(form.age),
        heightCm: form.heightCm === '' ? null : Number(form.heightCm),
        mbti: form.mbti === '' ? null : form.mbti,
        personalityTags: form.personalityTags,
        monologue: form.monologue === '' ? null : form.monologue,
        profileJson,
      },
    });
  };

  // AI 逐项生成 — 返回到本地态,用户再次「保存」才入库
  const aiFill = async (field: 'mbti' | 'personalityTags' | 'monologue' | 'lifeNodes'): Promise<void> => {
    try {
      const res = await generate.mutateAsync({ assetId, field });
      if (res.warning) toast.warning(res.warning);
      setForm((prev) => {
        if (!prev) return prev;
        if (field === 'mbti' && typeof res.value === 'string') {
          return { ...prev, mbti: res.value };
        }
        if (field === 'monologue' && typeof res.value === 'string') {
          return { ...prev, monologue: res.value };
        }
        if (field === 'personalityTags' && Array.isArray(res.value)) {
          return {
            ...prev,
            personalityTags: (res.value as unknown[]).filter(
              (t): t is string => typeof t === 'string',
            ),
          };
        }
        if (field === 'lifeNodes' && Array.isArray(res.value)) {
          return {
            ...prev,
            lifeNodes: (res.value as LifeNode[]).filter(
              (n) => typeof n.year === 'string' && typeof n.title === 'string',
            ),
          };
        }
        return prev;
      });
      toast.success(`已生成 ${field} 草案,请审阅后保存`);
    } catch (e) {
      toast.error(`生成失败:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const inputCls =
    'w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-[12px]';

  return (
    <div className="space-y-4 p-4">
      {/* 顶部:类型 + 同步状态 + 删除 */}
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--color-border))] pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {TYPE_LABEL[asset.type as AssetType] ?? asset.type}
          </Badge>
          {asset.syncedToArtAt ? (
            <Badge
              variant="outline"
              className="border-[hsl(var(--color-success))]/30 text-[10px] text-[hsl(var(--color-success))]"
            >
              <CheckCircle2 className="mr-0.5 size-2.5" />
              已同步美术工坊
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              未同步
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-[11px] text-[hsl(var(--color-destructive))]"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 className="size-3" />
            删除
          </Button>
        </div>
      </div>

      {/* 基础信息 */}
      <Section title="基础">
        <Field label="姓名 / 名称">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="text-[12px]"
          />
        </Field>
        {asset.type === 'CHARACTER' && (
          <Field label="角色定位">
            <select
              className={inputCls}
              value={form.characterRole}
              onChange={(e) => setForm({ ...form, characterRole: e.target.value })}
            >
              <option value="">— 未设定 —</option>
              {(['主演-男主', '主演-女主', '主演-反派', '配角-正派', '配角-反派', '配角-中性', '群演'] as const).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="外观 / 描述">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={cn(inputCls, 'min-h-[60px] resize-y')}
            placeholder="外貌、衣着、特征等(美术工坊生图会读)"
          />
        </Field>
        <Field label="基础 prompt(送图像模型的种子描述)">
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            className={cn(inputCls, 'min-h-[60px] resize-y font-mono')}
          />
        </Field>
      </Section>

      {/* 角色档案(仅人物显示;场景/道具也可看但内容默认空) */}
      {asset.type === 'CHARACTER' && (
        <Section title="角色档案(剧本拆解定稿)">
          <div className="grid grid-cols-3 gap-2">
            <Field label="性别">
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
            </Field>
            <Field label="年龄">
              <Input
                type="number"
                min={0}
                max={200}
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
                className="text-[12px]"
              />
            </Field>
            <Field label="身高(cm)">
              <Input
                type="number"
                min={0}
                max={300}
                value={form.heightCm}
                onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
                className="text-[12px]"
              />
            </Field>
          </div>

          <FieldWithAI
            label="MBTI"
            onAI={() => void aiFill('mbti')}
            aiLoading={generate.isPending && generate.variables?.field === 'mbti'}
          >
            <Input
              value={form.mbti}
              onChange={(e) => setForm({ ...form, mbti: e.target.value.toUpperCase().slice(0, 8) })}
              placeholder="INTJ"
              className="text-[12px] font-mono uppercase"
            />
          </FieldWithAI>

          <FieldWithAI
            label="性格标签(逗号分隔)"
            onAI={() => void aiFill('personalityTags')}
            aiLoading={generate.isPending && generate.variables?.field === 'personalityTags'}
          >
            <Input
              value={form.personalityTags.join(',')}
              onChange={(e) =>
                setForm({
                  ...form,
                  personalityTags: e.target.value
                    .split(/[,,]/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                })
              }
              placeholder="冷静, 强势, 重情义"
              className="text-[12px]"
            />
            {form.personalityTags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {form.personalityTags.map((t, i) => (
                  <Badge key={`${t}-${i}`} variant="secondary" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </FieldWithAI>

          <FieldWithAI
            label="内心独白(第一人称 · ≤40 字)"
            onAI={() => void aiFill('monologue')}
            aiLoading={generate.isPending && generate.variables?.field === 'monologue'}
          >
            <textarea
              value={form.monologue}
              onChange={(e) => setForm({ ...form, monologue: e.target.value.slice(0, 2000) })}
              className={cn(inputCls, 'min-h-[50px] resize-y')}
              placeholder="一句体现角色内核的独白"
            />
          </FieldWithAI>

          <FieldWithAI
            label="人生关键节点"
            onAI={() => void aiFill('lifeNodes')}
            aiLoading={generate.isPending && generate.variables?.field === 'lifeNodes'}
          >
            <LifeNodesEditor
              nodes={form.lifeNodes}
              onChange={(nodes) => setForm({ ...form, lifeNodes: nodes })}
            />
          </FieldWithAI>

          <Field label="嗓音特征(可填)">
            <Input
              value={form.voiceLabel}
              onChange={(e) => setForm({ ...form, voiceLabel: e.target.value.slice(0, 100) })}
              placeholder="低沉沙哑 / 清脆少年音 等"
              className="text-[12px]"
            />
          </Field>
        </Section>
      )}

      {/* 操作 */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-4 py-2">
        <Button
          size="sm"
          variant="default"
          onClick={save}
          disabled={update.isPending}
          className="gap-1"
        >
          {update.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3" />
          )}
          保存
        </Button>
      </div>

      {confirmDeleteOpen && (
        <ConfirmDialog
          title={`删除资产「${asset.name}」?`}
          description="软删 · 关联绑定也一起标删,不影响已生成的内容。"
          confirmLabel="删除"
          danger
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={() => {
            del.mutate({ assetId });
            setConfirmDeleteOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 中栏小组件
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-[hsl(var(--color-muted-foreground))]">
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldWithAI({
  label,
  onAI,
  aiLoading,
  children,
}: {
  label: string;
  onAI: () => void;
  aiLoading: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <label className="text-[10px] text-[hsl(var(--color-muted-foreground))]">{label}</label>
        <button
          type="button"
          onClick={onAI}
          disabled={aiLoading}
          className="flex items-center gap-1 text-[10px] text-[hsl(var(--color-accent))] hover:underline disabled:opacity-50"
          title="基于已填字段调 LLM 生成草案,你审阅后再保存"
        >
          {aiLoading ? (
            <Loader2 className="size-2.5 animate-spin" />
          ) : (
            <Wand2 className="size-2.5" />
          )}
          AI 生成
        </button>
      </div>
      {children}
    </div>
  );
}

// LifeNodesEditor 已抽到 @/components/asset-profile-fields(与美术工坊共享)

// ---------------------------------------------------------------------------
// 右栏:关联列表 + 新建关联 + 单资产同步
// ---------------------------------------------------------------------------

function RelationsPanel({
  assetId,
  projectId,
  allAssets,
}: {
  assetId: string;
  projectId: string;
  allAssets: AssetItem[];
}): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: relations, isLoading } = trpc.asset.listRelations.useQuery({ assetId });

  const createRel = trpc.asset.createRelation.useMutation({
    onSuccess: () => {
      toast.success('已添加关联');
      void utils.asset.listRelations.invalidate({ assetId });
    },
    onError: (e) => toast.error(`添加失败:${e.message}`),
  });

  const deleteRel = trpc.asset.deleteRelation.useMutation({
    onSuccess: () => {
      toast.success('已删除关联');
      void utils.asset.listRelations.invalidate({ assetId });
    },
    onError: (e) => toast.error(`删除失败:${e.message}`),
  });

  const syncOne = trpc.asset.syncToArt.useMutation({
    onSuccess: (res) => {
      if (res.syncedCount === 0) {
        toast.info('该资产已是同步状态(本次未变化)');
      } else {
        toast.success('已同步到美术工坊');
      }
      void utils.asset.list.invalidate();
      void utils.asset.get.invalidate({ assetId });
    },
    onError: (e) => toast.error(`同步失败:${e.message}`),
  });

  const [addOpen, setAddOpen] = React.useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* 顶部 */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-3 py-2">
        <h3 className="flex items-center gap-1 text-[12px] font-medium">
          <Link2 className="size-3.5" />
          关联
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-3" />
          新建
        </Button>
      </div>

      {/* 关联列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center gap-2 p-2 text-[11px] text-[hsl(var(--color-muted-foreground))]">
            <Loader2 className="size-3 animate-spin" /> 加载…
          </div>
        ) : !relations || relations.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-[hsl(var(--color-muted-foreground))]">
            暂无关联
          </div>
        ) : (
          <ul className="space-y-1">
            {relations.map((r) => (
              <li
                key={r.id}
                className="rounded border border-[hsl(var(--color-border))] p-2"
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className="px-1 py-0 text-[9px] uppercase"
                      >
                        {r.direction === 'OUT' ? '→' : '←'}
                      </Badge>
                      <span className="truncate text-[12px] font-medium">
                        {r.other.name}
                      </span>
                      <Badge variant="secondary" className="ml-auto text-[9px]">
                        {TYPE_LABEL[r.other.type as AssetType] ?? r.other.type}
                      </Badge>
                    </div>
                    {r.relationLabel && (
                      <p className="mt-0.5 text-[11px] text-[hsl(var(--color-muted-foreground))]">
                        {r.relationLabel}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteRel.mutate({ relationId: r.id })}
                    className="flex size-5 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-destructive)/0.1)] hover:text-[hsl(var(--color-destructive))]"
                    title="删除关联"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 底部:单资产同步 */}
      <div className="border-t border-[hsl(var(--color-border))] p-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1 text-[11px]"
          onClick={() => syncOne.mutate({ projectId, assetIds: [assetId] })}
          disabled={syncOne.isPending}
          title="把本资产标记同步到美术工坊(已同步过则不变化)"
        >
          {syncOne.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Send className="size-3" />
          )}
          同步本资产到美术工坊
        </Button>
      </div>

      {/* 新建关联 dialog */}
      <NewRelationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        currentAssetId={assetId}
        allAssets={allAssets}
        onConfirm={(toAssetId, label) => {
          createRel.mutate({
            fromAssetId: assetId,
            toAssetId,
            relationLabel: label || undefined,
          });
          setAddOpen(false);
        }}
        pending={createRel.isPending}
      />
    </div>
  );
}

function NewRelationDialog({
  open,
  onOpenChange,
  currentAssetId,
  allAssets,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentAssetId: string;
  allAssets: AssetItem[];
  onConfirm: (toAssetId: string, label: string) => void;
  pending: boolean;
}): React.ReactElement {
  const [toId, setToId] = React.useState('');
  const [label, setLabel] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setToId('');
      setLabel('');
    }
  }, [open]);

  const candidates = allAssets.filter((a) => a.id !== currentAssetId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建关联</DialogTitle>
          <DialogDescription>把当前资产关联到另一个项目内资产(单向)。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium">关联到</label>
            <select
              className="w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-[12px]"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            >
              <option value="">— 选资产 —</option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  [{TYPE_LABEL[a.type as AssetType] ?? a.type}] {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">
              关系描述(可选)
            </label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 2000))}
              placeholder="父子 / 师徒 / 同门 / 居住于 等"
              className="text-[12px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(toId, label)}
            disabled={!toId || pending}
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 新建资产 dialog(最小可用 — 名称 + 类型 + prompt;后续可加 AI 拆解入口)
// ---------------------------------------------------------------------------

function NewAssetDialog({
  open,
  onOpenChange,
  projectId,
  defaultType,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  defaultType: AssetType;
  onCreated: (id: string) => void;
}): React.ReactElement {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<AssetType>(defaultType);
  const [prompt, setPrompt] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setName('');
      setPrompt('');
      setType(defaultType);
    } else {
      setType(defaultType);
    }
  }, [open, defaultType]);

  const create = trpc.asset.create.useMutation({
    onSuccess: (res) => {
      toast.success(`已新建「${res.name}」`);
      onCreated(res.id);
      onOpenChange(false);
    },
    onError: (e) => toast.error(`新建失败:${e.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建资产</DialogTitle>
          <DialogDescription>
            创建后在中栏继续完善档案。可选「批量拆解」从剧本自动生成多个。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium">类型</label>
            <div className="flex gap-1">
              {(['CHARACTER', 'SCENE', 'PROP'] as const).map((t) => {
                const Icon = TYPE_ICON[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px]',
                      type === t
                        ? 'border-[hsl(var(--color-accent))] bg-[hsl(var(--color-accent)/0.08)] text-[hsl(var(--color-accent))]'
                        : 'border-[hsl(var(--color-border))] text-[hsl(var(--color-muted-foreground))]',
                    )}
                  >
                    <Icon className="size-3.5" />
                    {TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 100))}
              placeholder="角色名 / 场景名 / 道具名"
              className="text-[12px]"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium">
              基础 prompt(送图像模型的种子描述)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 5000))}
              placeholder="例:东方仙侠风格,十六岁少年,白衣……"
              className="min-h-[80px] w-full resize-y rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 font-mono text-[11px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() =>
              create.mutate({
                projectId,
                type,
                name,
                prompt: prompt || '(待补)',
                alias: [],
                description: '',
                tags: [],
              })
            }
            disabled={!name || create.isPending}
            className="gap-1"
          >
            {create.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Sparkles className="size-3" />
            )}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
