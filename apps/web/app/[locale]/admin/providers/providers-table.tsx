'use client';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCny, cn } from '@/lib/utils';

// ----------------------------------------------------------------------------
// 类型
// ----------------------------------------------------------------------------

type Provider = {
  providerId: string;
  displayName: string;
  kind: string;
  isActive: boolean;
  apiUrl: string | null;
  apiKeyMasked: string | null;
  apiKeyConfigured: boolean;
  apiKeySource: 'db' | 'env' | 'none';
  apiKeyUpdatedAt: Date | null;
  apiKeyUpdatedBy: string | null;
  unitPriceCny: number;
  unitName: string;
  // Phase 1.5.1 — backend listProviderConfigs 新加字段
  modelRate: number | null;
  outputRate: number | null;
  defaultModel: string | null;
  source: 'relay' | 'subscription' | 'direct' | 'local' | null;
};

const KIND_ORDER_RELAY = ['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'COMPLIANCE'] as const;
const KIND_ORDER_DIRECT: Record<string, number> = {
  VIDEO: 1,
  IMAGE: 2,
  TEXT: 3,
  COMPLIANCE: 4,
  AUDIO: 5,
  EMBEDDING: 6,
};

const KIND_META: Record<
  string,
  { emoji: string; label: string; subtitle: string }
> = {
  TEXT: { emoji: '💬', label: 'LLM 文本模型', subtitle: '剧本分析 / 分镜生成 / 资产拆解' },
  IMAGE: { emoji: '🎨', label: '图像模型', subtitle: '资产首图 / 三视图 / 全景' },
  VIDEO: { emoji: '🎬', label: '视频模型', subtitle: 'AIGC 抽卡' },
  AUDIO: { emoji: '🎵', label: '音频模型', subtitle: 'TTS / 配乐' },
  COMPLIANCE: { emoji: '🛡️', label: '合规模型', subtitle: '人物合规 / 内容审核' },
  EMBEDDING: { emoji: '🧠', label: 'Embedding 模型', subtitle: '向量检索 / 语义匹配' },
};

// ----------------------------------------------------------------------------
// 主组件
// ----------------------------------------------------------------------------

export function ProvidersTable(): React.ReactElement {
  const t = useTranslations();
  const { data: providers, isLoading, refetch: refetchProviders } =
    trpc.admin.provider.list.useQuery();
  const { data: credential, refetch: refetchCredential } =
    trpc.admin.relay.getCredential.useQuery();

  const { relayByKind, directProviders } = React.useMemo(() => {
    if (!providers) return { relayByKind: {}, directProviders: [] };
    const relay: Record<string, Provider[]> = {};
    const direct: Provider[] = [];
    for (const p of providers) {
      if (p.providerId.startsWith('relay-')) {
        (relay[p.kind] ??= []).push(p);
      } else {
        direct.push(p);
      }
    }
    // 排序 relay 每组按 providerId
    for (const k of Object.keys(relay)) {
      relay[k]!.sort((a, b) => a.providerId.localeCompare(b.providerId));
    }
    // 直连按 kind 优先级
    direct.sort(
      (a, b) =>
        (KIND_ORDER_DIRECT[a.kind] ?? 99) - (KIND_ORDER_DIRECT[b.kind] ?? 99) ||
        a.providerId.localeCompare(b.providerId),
    );
    return { relayByKind: relay, directProviders: direct };
  }, [providers]);

  if (isLoading) {
    return <Card className="h-96 animate-pulse" />;
  }

  const onAnyChange = (): void => {
    void refetchProviders();
    void refetchCredential();
  };

  return (
    <div className="space-y-8">
      {/* 1. 中转站凭证(顶部) */}
      <RelayCredentialSection
        credential={credential ?? null}
        onChange={onAnyChange}
        t={t}
      />

      {/* 2. 中转站模型(按 kind 分类) */}
      <RelayModelsSection
        relayByKind={relayByKind}
        hasCredential={credential?.hasCredential ?? false}
        onChange={onAnyChange}
        t={t}
      />

      {/* 3. 直连 Provider(高亮) */}
      <DirectProvidersSection
        providers={directProviders}
        onChange={onAnyChange}
        t={t}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Section 1: 中转站凭证
// ----------------------------------------------------------------------------

type Credential = {
  apiUrl: string;
  apiKeyMasked: string | null;
  apiKeyUpdatedAt: Date | null;
  apiKeyUpdatedBy: string | null;
  hasCredential: boolean;
  attachedProviderCount: number;
  inconsistent: boolean;
};

function RelayCredentialSection({
  credential,
  onChange,
  t: _t,
}: {
  credential: Credential | null;
  onChange: () => void;
  t: ReturnType<typeof useTranslations>;
}): React.ReactElement {
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);

  React.useEffect(() => {
    if (credential?.apiUrl && apiUrl === '') setApiUrl(credential.apiUrl);
  }, [credential?.apiUrl, apiUrl]);

  const setCred = trpc.admin.relay.setCredential.useMutation({
    onSuccess: () => {
      setApiKey('');
      onChange();
    },
  });
  const clearCred = trpc.admin.relay.clearCredential.useMutation({
    onSuccess: () => {
      setApiKey('');
      onChange();
    },
  });

  const canSubmit = apiUrl.length > 0 && apiKey.length >= 8 && !setCred.isPending;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base">📦</span>
        <h2 className="text-base font-semibold">中转站凭证 · Relay Credential</h2>
        <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
          一个 token 共享所有 relay-* 模型
        </span>
      </div>

      <Card className="p-4">
        {/* 当前状态 */}
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <StatBlock
            label="状态"
            value={
              credential?.hasCredential ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="size-3" /> 已配
                </Badge>
              ) : (
                <Badge variant="destructive">未配 · 所有 relay-* 模型无法启用</Badge>
              )
            }
          />
          <StatBlock
            label="共享给"
            value={
              <span className="font-mono text-sm">
                {credential?.attachedProviderCount ?? 0} 个 relay-* 模型
              </span>
            }
          />
          <StatBlock
            label="上次更新"
            value={
              <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                {credential?.apiKeyUpdatedAt
                  ? new Date(credential.apiKeyUpdatedAt).toLocaleString()
                  : '—'}
              </span>
            }
          />
        </div>

        {credential?.inconsistent && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <div className="font-medium text-amber-900 dark:text-amber-200">
                检测到中转站凭证不一致
              </div>
              <div className="mt-0.5 text-amber-800/80 dark:text-amber-300/80">
                部分 relay-* provider 的 apiUrl / apiKey 跟其他不同(历史 setApiKey 遗留)。
                重新填下方表单点"批量同步"即可修复 — 会把同 token 同步到所有 8 个 relay-* 模型。
              </div>
            </div>
          </div>
        )}

        {/* 当前已配 mask 显示 */}
        {credential?.hasCredential && (
          <div className="mb-4 rounded-md bg-[hsl(var(--color-secondary)/0.5)] px-3 py-2 text-sm">
            <span className="text-xs text-[hsl(var(--color-muted-foreground))]">当前:</span>{' '}
            <span className="font-mono">{credential.apiUrl}</span>
            <span className="mx-2 text-[hsl(var(--color-muted-foreground))]">·</span>
            <span className="font-mono">{credential.apiKeyMasked}</span>
          </div>
        )}

        {/* 表单 */}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="relay-url">Base URL</Label>
            <Input
              id="relay-url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://<your-relay-host>/v1"
              className="font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="relay-key">API Key</Label>
            <div className="flex gap-1.5">
              <Input
                id="relay-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0 px-2"
                aria-label={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <Button
              onClick={() => setCred.mutate({ apiUrl, apiKey })}
              disabled={!canSubmit}
              className="gap-1.5"
            >
              {setCred.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              批量同步
            </Button>
            {credential?.hasCredential && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => clearCred.mutate()}
                disabled={clearCred.isPending}
                className="gap-1.5"
              >
                {clearCred.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                清除
              </Button>
            )}
          </div>
        </div>

        {setCred.error && (
          <p className="mt-3 rounded-md bg-[hsl(var(--color-destructive)/0.15)] px-3 py-2 text-sm text-[hsl(var(--color-destructive))]">
            {setCred.error.message}
          </p>
        )}
        {setCred.data && (
          <p className="mt-3 rounded-md bg-green-500/15 px-3 py-2 text-sm text-green-700 dark:text-green-300">
            ✓ 批量同步成功 · 已应用到 {setCred.data.affectedCount} 个 relay-* 模型
          </p>
        )}

        <p className="mt-3 text-xs text-[hsl(var(--color-muted-foreground))]">
          适用于任意 OpenAI 兼容中转站(OpenRouter / Poe / OneAPI 自部署 等)。Token 经 AES-256-GCM 加密入库,仅服务端解密。
        </p>
      </Card>
    </section>
  );
}

// ----------------------------------------------------------------------------
// Section 2: 中转站模型(按 kind 分类)
// ----------------------------------------------------------------------------

function RelayModelsSection({
  relayByKind,
  hasCredential,
  onChange,
  t: _t,
}: {
  relayByKind: Record<string, Provider[]>;
  hasCredential: boolean;
  onChange: () => void;
  t: ReturnType<typeof useTranslations>;
}): React.ReactElement {
  const totalCount = Object.values(relayByKind).reduce((s, arr) => s + arr.length, 0);
  const activeCount = Object.values(relayByKind)
    .flat()
    .filter((p) => p.isActive).length;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base">🌐</span>
        <h2 className="text-base font-semibold">中转站模型 · Relay Models</h2>
        <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
          {activeCount} / {totalCount} 启用 · 启用后才出现在 /admin/bindings 选项
        </span>
      </div>

      {!hasCredential && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="text-amber-900 dark:text-amber-200">
            未配中转站凭证 — 启用按钮已禁用,先在上方表单填 Base URL + API Key 批量同步
          </div>
        </div>
      )}

      <div className="space-y-4">
        {KIND_ORDER_RELAY.map((kind) => {
          const list = relayByKind[kind] ?? [];
          if (list.length === 0) return null;
          const meta = KIND_META[kind] ?? { emoji: '🔧', label: kind, subtitle: '' };
          return (
            <Card key={kind} className="overflow-hidden">
              <div className="border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-secondary)/0.3)] px-4 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <span className="text-xs font-normal text-[hsl(var(--color-muted-foreground))]">
                    · {meta.subtitle} · {list.length} 个模型
                  </span>
                </div>
              </div>
              <div>
                {list.map((p) => (
                  <RelayModelRow
                    key={p.providerId}
                    provider={p}
                    canEnable={hasCredential}
                    onChange={onChange}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function RelayModelRow({
  provider,
  canEnable,
  onChange,
}: {
  provider: Provider;
  canEnable: boolean;
  onChange: () => void;
}): React.ReactElement {
  const setActive = trpc.admin.provider.setActive.useMutation({ onSuccess: onChange });

  // 提取关键计费参数显示
  const priceLabel = formatModelPrice(provider);

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--color-border)/0.4)] px-4 py-3 last:border-b-0 hover:bg-[hsl(var(--color-secondary)/0.2)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.displayName}</span>
        </div>
        <div className="mt-0.5 font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
          {provider.providerId}
        </div>
        <div className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
          {priceLabel}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={cn(
            'text-xs',
            provider.isActive
              ? 'font-medium text-green-700 dark:text-green-400'
              : 'text-[hsl(var(--color-muted-foreground))]',
          )}
        >
          {provider.isActive ? '已启用' : '停用'}
        </span>
        <ToggleSwitch
          checked={provider.isActive}
          disabled={!canEnable && !provider.isActive}
          loading={setActive.isPending}
          onChange={(v) =>
            setActive.mutate({ providerId: provider.providerId, isActive: v })
          }
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Section 3: 直连 Provider(高亮)
// ----------------------------------------------------------------------------

function DirectProvidersSection({
  providers,
  onChange,
  t: _t,
}: {
  providers: Provider[];
  onChange: () => void;
  t: ReturnType<typeof useTranslations>;
}): React.ReactElement {
  const [editing, setEditing] = React.useState<Provider | null>(null);
  if (providers.length === 0) return <></>;

  // 直连按 kind 分组
  const grouped: Record<string, Provider[]> = {};
  for (const p of providers) {
    (grouped[p.kind] ??= []).push(p);
  }

  const activeCount = providers.filter((p) => p.isActive).length;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-amber-500" />
        <h2 className="text-base font-semibold">直连 Provider · Direct (独立 API Key)</h2>
        <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
          {activeCount} / {providers.length} 启用 · 每个独立配置
        </span>
      </div>

      <div className="space-y-3">
        {Object.entries(grouped).map(([kind, list]) => {
          const meta = KIND_META[kind] ?? { emoji: '🔧', label: kind, subtitle: '' };
          return (
            <Card
              key={kind}
              className="overflow-hidden border-l-4 border-amber-500/70"
            >
              <div className="border-b border-[hsl(var(--color-border))] bg-amber-500/5 px-4 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{meta.emoji}</span>
                  <span>{meta.label}</span>
                  <Badge variant="warning" className="text-[10px]">
                    独立 API Key
                  </Badge>
                </div>
              </div>
              <div>
                {list.map((p) => (
                  <DirectProviderRow
                    key={p.providerId}
                    provider={p}
                    onEditKey={() => setEditing(p)}
                    onChange={onChange}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {editing && (
        <SetApiKeyDialog
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            onChange();
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function DirectProviderRow({
  provider,
  onEditKey,
  onChange,
}: {
  provider: Provider;
  onEditKey: () => void;
  onChange: () => void;
}): React.ReactElement {
  const setActive = trpc.admin.provider.setActive.useMutation({ onSuccess: onChange });

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[hsl(var(--color-border)/0.4)] px-4 py-3 last:border-b-0 hover:bg-[hsl(var(--color-secondary)/0.2)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.displayName}</span>
        </div>
        <div className="mt-0.5 font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
          {provider.providerId}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[hsl(var(--color-muted-foreground))]">
            {formatCny(provider.unitPriceCny)}/{provider.unitName}
          </span>
          {provider.apiUrl && (
            <>
              <span className="text-[hsl(var(--color-muted-foreground))]">·</span>
              <span className="font-mono text-[hsl(var(--color-muted-foreground))]">
                {provider.apiUrl}
              </span>
            </>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          {provider.apiKeyConfigured ? (
            <>
              <span className="font-mono">{provider.apiKeyMasked ?? '••••'}</span>
              <Badge
                variant={provider.apiKeySource === 'db' ? 'default' : 'warning'}
                className="text-[10px]"
              >
                {provider.apiKeySource === 'db' ? 'DB' : 'ENV'}
              </Badge>
            </>
          ) : (
            <Badge variant="destructive" className="text-[10px]">
              未配
            </Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onEditKey} className="gap-1">
          <KeyRound className="size-3.5" />
          {provider.apiKeyConfigured ? '更换' : '设置'}
        </Button>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs',
              provider.isActive
                ? 'font-medium text-green-700 dark:text-green-400'
                : 'text-[hsl(var(--color-muted-foreground))]',
            )}
          >
            {provider.isActive ? '已启用' : '停用'}
          </span>
          <ToggleSwitch
            checked={provider.isActive}
            disabled={!provider.apiKeyConfigured && !provider.isActive}
            loading={setActive.isPending}
            onChange={(v) =>
              setActive.mutate({ providerId: provider.providerId, isActive: v })
            }
          />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 工具组件
// ----------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  loading = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || loading}
      onClick={() => !disabled && !loading && onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-green-500' : 'bg-gray-400/40',
        (disabled || loading) && 'cursor-not-allowed opacity-50',
        !disabled && !loading && 'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      >
        {loading && (
          <Loader2 className="size-5 animate-spin p-0.5 text-gray-600" />
        )}
      </span>
    </button>
  );
}

function StatBlock({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-2">
      <div className="text-[10px] uppercase text-[hsl(var(--color-muted-foreground))]">
        {label}
      </div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function formatModelPrice(p: Provider): React.ReactNode {
  // 优先显示中转站 2 倍率(modelRate / outputRate)
  if (p.modelRate != null && p.modelRate > 0) {
    const outputCost = p.modelRate * (p.outputRate ?? 1);
    return (
      <span>
        ¥{p.modelRate.toFixed(2)}/M 输入 · ¥{outputCost.toFixed(2)}/M 输出
        {p.outputRate != null && p.outputRate !== 1 && (
          <span className="ml-1 text-[hsl(var(--color-muted-foreground))]">
            (输出 {p.outputRate}×)
          </span>
        )}
      </span>
    );
  }
  // 否则显示 unitPriceCny / unitName
  return (
    <span>
      {formatCny(p.unitPriceCny)}/{p.unitName}
    </span>
  );
}

// ----------------------------------------------------------------------------
// SetApiKey Dialog(直连 Provider 用,保留原对话框)
// ----------------------------------------------------------------------------

function SetApiKeyDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: Provider;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [value, setValue] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);

  const setKey = trpc.admin.provider.setApiKey.useMutation({ onSuccess: onSaved });
  const clearKey = trpc.admin.provider.clearApiKey.useMutation({ onSuccess: onSaved });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('modules.admin.providerKey.setKey')}</DialogTitle>
          <DialogDescription>
            <span className="text-[hsl(var(--color-foreground))]">
              {provider.displayName}
            </span>
            <span className="ml-2 font-mono text-xs">{provider.providerId}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>当前值 / Current</Label>
            {provider.apiKeyConfigured ? (
              <code className="block rounded-md bg-[hsl(var(--color-secondary))] px-3 py-2 font-mono text-sm">
                {provider.apiKeyMasked ?? '••••••••'}
              </code>
            ) : (
              <Badge variant="destructive" className="w-fit">
                {t('modules.admin.providerKey.notSet')}
              </Badge>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apikey">新的 API Key / New API Key</Label>
            <div className="flex gap-2">
              <Input
                id="apikey"
                type={showKey ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="sk-..."
                autoFocus
                className="font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0"
              >
                {showKey ? '隐藏' : '显示'}
              </Button>
            </div>
            <p className="text-xs text-[hsl(var(--color-muted-foreground))]">
              ⚠️ 此 Key 将通过 AES-256-GCM 加密存储到数据库,仅在服务端解密使用。
            </p>
          </div>

          {setKey.error && (
            <p className="rounded-md bg-[hsl(var(--color-destructive)/0.15)] px-3 py-2 text-sm text-[hsl(var(--color-destructive))]">
              {setKey.error.message}
            </p>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          {provider.apiKeyConfigured && provider.apiKeySource === 'db' && (
            <Button
              variant="destructive"
              onClick={() => clearKey.mutate({ providerId: provider.providerId })}
              disabled={clearKey.isPending}
              className={cn('gap-1.5', 'mr-auto')}
            >
              <Trash2 className="size-4" />
              {t('modules.admin.providerKey.clearKey')}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={setKey.isPending}>
              {t('actions.cancel')}
            </Button>
            <Button
              onClick={() =>
                setKey.mutate({ providerId: provider.providerId, apiKey: value })
              }
              disabled={!value || value.length < 8 || setKey.isPending}
            >
              {setKey.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              {t('actions.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
