'use client';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Circle, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';
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
};

const KIND_ORDER: Record<string, number> = {
  VIDEO: 1,
  IMAGE: 2,
  TEXT: 3,
  COMPLIANCE: 4,
  AUDIO: 5,
  EMBEDDING: 6,
};

export function ProvidersTable(): React.ReactElement {
  const t = useTranslations();
  const { data, isLoading, refetch } = trpc.admin.provider.list.useQuery();
  const [editing, setEditing] = React.useState<Provider | null>(null);

  const grouped = React.useMemo(() => {
    if (!data) return [];
    const sorted = [...data].sort(
      (a, b) =>
        (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99) ||
        a.providerId.localeCompare(b.providerId),
    );
    const groups: Record<string, Provider[]> = {};
    for (const p of sorted) {
      (groups[p.kind] ??= []).push(p);
    }
    return Object.entries(groups);
  }, [data]);

  if (isLoading) {
    return <Card className="h-96 animate-pulse" />;
  }

  return (
    <>
      <div className="space-y-6">
        {grouped.map(([kind, providers]) => (
          <div key={kind}>
            <h2 className="mb-2 text-sm font-medium text-[hsl(var(--color-muted-foreground))]">
              {t(`enums.providerKind.${kind}`)} ({providers.length})
            </h2>
            <Card>
              <table className="w-full text-sm">
                <thead className="border-b border-[hsl(var(--color-border))] text-xs text-[hsl(var(--color-muted-foreground))]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Provider</th>
                    <th className="px-4 py-2.5 text-left font-medium">状态 / Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">API Key</th>
                    <th className="px-4 py-2.5 text-left font-medium">单价 / Price</th>
                    <th className="px-4 py-2.5 text-left font-medium">最后更新</th>
                    <th className="px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr
                      key={p.providerId}
                      className="border-b border-[hsl(var(--color-border)/0.5)] transition-colors hover:bg-[hsl(var(--color-secondary)/0.3)]"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.displayName}</div>
                        <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
                          {p.providerId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {p.isActive ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="size-3" /> 已启用
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Circle className="size-3" /> 停用
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.apiKeyConfigured ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">{p.apiKeyMasked ?? '••••••••'}</span>
                            <Badge
                              variant={p.apiKeySource === 'db' ? 'default' : 'warning'}
                              className="text-[10px]"
                            >
                              {p.apiKeySource === 'db'
                                ? t('modules.admin.providerKey.fromDb')
                                : t('modules.admin.providerKey.fromEnv')}
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            {t('modules.admin.providerKey.notSet')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono">{formatCny(p.unitPriceCny)}</span>
                        <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                          /{p.unitName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[hsl(var(--color-muted-foreground))]">
                        {p.apiKeyUpdatedAt
                          ? new Date(p.apiKeyUpdatedAt).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(p)} className="gap-1">
                            <KeyRound className="size-3.5" />
                            {p.apiKeyConfigured ? '更换' : '设置'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        ))}
      </div>

      {editing && (
        <SetApiKeyDialog
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void refetch();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

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
            <span className="text-[hsl(var(--color-foreground))]">{provider.displayName}</span>
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
              ⚠️ 此 Key 将通过 AES-256-GCM 加密存储到数据库，仅在服务端解密使用。
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
                <RefreshCw className="size-4" />
              )}
              {t('actions.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
