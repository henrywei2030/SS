'use client';
import { Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { Provider } from './providers-shared';
import { ToggleSwitch, formatModelPrice } from './providers-toggle-switch';

// ============================================================================
// 子组件:模型行(中转站 + 直连共用)
// ============================================================================

export function ModelRow({
  provider,
  onChange,
  isDirect = false,
}: {
  provider: Provider;
  onChange: () => void;
  isDirect?: boolean;
}): React.ReactElement {
  const [editingKey, setEditingKey] = React.useState(false);
  const [newKey, setNewKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);

  const setActive = trpc.admin.provider.setActive.useMutation({ onSuccess: onChange });
  const setProviderKey = trpc.admin.provider.setApiKey.useMutation({
    onSuccess: () => {
      setNewKey('');
      setEditingKey(false);
      onChange();
    },
  });
  // Phase 1.5.2:删除按钮 — 从展示界面移除,放回下拉候选(下次可重新加)
  // 2026-06-13(用户:所有配置可直接删):后端已去掉「含 key」「active」守卫,直接删即清 key + 缓存
  const deleteProvider = trpc.admin.provider.delete.useMutation({
    onSuccess: onChange,
    onError: (err) => alert(err.message),
  });
  const handleDelete = (): void => {
    if (
      !confirm(
        `从列表移除 "${provider.displayName}"?\n(可下次从下拉重新添加 · 不会影响中转站凭证)`,
      )
    )
      return;
    deleteProvider.mutate({ providerId: provider.providerId, confirmDelete: true });
  };

  const priceLabel = formatModelPrice(provider);
  const canEnable = provider.apiKeyConfigured;

  return (
    <div className="flex flex-col gap-2 border-b border-[hsl(var(--color-border)/0.4)] px-4 py-3 last:border-b-0 hover:bg-[hsl(var(--color-secondary)/0.2)] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{provider.displayName}</span>
          {provider.relayProviderDisplayName && (
            <Badge variant="default" className="text-[10px]">
              via {provider.relayProviderName}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
          {provider.providerId}
        </div>
        <div className="mt-1 text-xs text-[hsl(var(--color-muted-foreground))]">
          {priceLabel}
        </div>
        {/* 直连显示 apiUrl + apiKey */}
        {isDirect && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {provider.apiUrl && (
              <span className="font-mono text-[hsl(var(--color-muted-foreground))]">
                {provider.apiUrl}
              </span>
            )}
            {provider.apiKeyConfigured ? (
              <>
                <span className="font-mono">{provider.apiKeyMasked}</span>
                <Badge
                  variant={provider.apiKeySource === 'db' ? 'default' : 'warning'}
                  className="text-[10px]"
                >
                  {provider.apiKeySource === 'db' ? 'DB' : provider.apiKeySource}
                </Badge>
              </>
            ) : (
              <Badge variant="destructive" className="text-[10px]">未配 Key</Badge>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isDirect && (
          <>
            {editingKey ? (
              <div className="flex items-center gap-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="sk-..."
                  className="h-7 w-40 font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowKey((v) => !v)}
                  className="h-7 px-2"
                >
                  {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setProviderKey.mutate({
                      providerId: provider.providerId,
                      apiKey: newKey,
                    })
                  }
                  disabled={newKey.length < 8 || setProviderKey.isPending}
                  className="h-7 px-2"
                >
                  保存
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingKey(false)}
                  className="h-7 px-2"
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingKey(true)}
                className="gap-1 h-7"
              >
                <KeyRound className="size-3.5" />
                {provider.apiKeyConfigured ? '更换' : '设置'}
              </Button>
            )}
          </>
        )}
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
        {/* Phase 1.5.2:从展示移除(放回下拉候选) */}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          disabled={deleteProvider.isPending}
          className="size-7 p-0 text-red-600 hover:text-red-700"
          aria-label="从列表移除"
          title="从列表移除(直接删除,含 key 也一并清掉)"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
