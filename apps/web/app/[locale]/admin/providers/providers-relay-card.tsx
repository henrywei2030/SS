'use client';
import { Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { RelayProvider } from './providers-shared';
import { ToggleSwitch } from './providers-toggle-switch';

export function RelayCard({
  relay,
  onChange,
}: {
  relay: RelayProvider;
  onChange: () => void;
}): React.ReactElement {
  const [editingKey, setEditingKey] = React.useState(false);
  const [editingUrl, setEditingUrl] = React.useState(false);
  const [newUrl, setNewUrl] = React.useState(relay.apiUrl ?? '');
  const [newKey, setNewKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);

  // Audit 修(F-P0-3):打开编辑时同步当前 relay.apiUrl(防 stale closure)
  React.useEffect(() => {
    if (editingUrl) setNewUrl(relay.apiUrl ?? '');
  }, [editingUrl, relay.apiUrl]);

  const setApiKey = trpc.admin.relay.setApiKey.useMutation({
    onSuccess: () => {
      setNewKey('');
      setEditingKey(false);
      onChange();
    },
  });
  const clearApiKey = trpc.admin.relay.clearApiKey.useMutation({ onSuccess: onChange });
  const updateRelay = trpc.admin.relay.update.useMutation({
    onSuccess: () => {
      setEditingUrl(false);
      onChange();
    },
  });
  const deleteRelay = trpc.admin.relay.delete.useMutation({ onSuccess: onChange });

  const toggleActive = (): void => {
    updateRelay.mutate({ id: relay.id, isActive: !relay.isActive });
  };

  return (
    <Card className={cn('p-4', !relay.isActive && 'opacity-60')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">🏷 {relay.displayName}</span>
            {relay.isActive ? (
              <Badge variant="success" className="text-[10px]">已启用</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">停用</Badge>
            )}
            {relay.catalogKey && (
              <Badge variant="default" className="text-[10px]">
                catalog: {relay.catalogKey}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
            {relay.name}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ToggleSwitch checked={relay.isActive} onChange={toggleActive} loading={updateRelay.isPending} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const n = relay.attachedProviderCount;
              if (
                confirm(
                  n > 0
                    ? `删除中转站 "${relay.displayName}"?\n会一并删掉它关联的 ${n} 个模型(指向它们的绑定将变「未注册」)。`
                    : `删除中转站 "${relay.displayName}"?(没有关联模型)`,
                )
              )
                deleteRelay.mutate({ id: relay.id, confirmDelete: true });
            }}
            disabled={deleteRelay.isPending}
            className="size-7 p-0 text-red-600"
            aria-label="删除"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* apiUrl */}
      <div className="mt-2 text-xs">
        <span className="text-[hsl(var(--color-muted-foreground))]">URL:</span>{' '}
        {editingUrl ? (
          <div className="mt-1 flex gap-1">
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-relay/v1"
              className="h-7 font-mono text-xs"
            />
            <Button
              size="sm"
              onClick={() => updateRelay.mutate({ id: relay.id, apiUrl: newUrl })}
              disabled={!newUrl || updateRelay.isPending}
              className="h-7 px-2"
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingUrl(false)} className="h-7 px-2">
              取消
            </Button>
          </div>
        ) : (
          <span className="cursor-pointer font-mono hover:underline" onClick={() => setEditingUrl(true)}>
            {relay.apiUrl || <span className="text-red-500">未设置(点击编辑)</span>}
          </span>
        )}
      </div>

      {/* apiKey */}
      <div className="mt-2 text-xs">
        <span className="text-[hsl(var(--color-muted-foreground))]">Key:</span>{' '}
        {editingKey ? (
          <div className="mt-1 flex gap-1">
            <div className="flex-1 flex gap-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="sk-..."
                className="h-7 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowKey((v) => !v)}
                className="h-7 px-2"
                aria-label={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </Button>
            </div>
            <Button
              size="sm"
              onClick={() => setApiKey.mutate({ id: relay.id, apiKey: newKey })}
              disabled={newKey.length < 8 || setApiKey.isPending}
              className="h-7 px-2"
            >
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingKey(false)} className="h-7 px-2">
              取消
            </Button>
          </div>
        ) : relay.apiKeyConfigured ? (
          <>
            <span className="font-mono">{relay.apiKeyMasked}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingKey(true)} className="ml-2 h-6 px-2">
              更换
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm('清除 API Key?所有关联模型将无法用'))
                  clearApiKey.mutate({ id: relay.id });
              }}
              className="h-6 px-2 text-red-600"
              disabled={clearApiKey.isPending}
            >
              清除
            </Button>
          </>
        ) : (
          <>
            <span className="text-red-500">未配置</span>
            <Button size="sm" variant="outline" onClick={() => setEditingKey(true)} className="ml-2 h-6 px-2 gap-1">
              <KeyRound className="size-3" /> 设置
            </Button>
          </>
        )}
      </div>

      <div className="mt-2 text-xs text-[hsl(var(--color-muted-foreground))]">
        关联 {relay.attachedProviderCount} 个模型({relay.attachedActiveCount} 启用)
        {relay.apiKeyUpdatedAt &&
          ` · ${new Date(relay.apiKeyUpdatedAt).toLocaleString()}`}
      </div>
      {setApiKey.error && (
        <p className="mt-2 text-xs text-red-600">{setApiKey.error.message}</p>
      )}
      {updateRelay.error && (
        <p className="mt-2 text-xs text-red-600">{updateRelay.error.message}</p>
      )}
      {/* Audit 修(F-P1-1):clearApiKey 错误也显示 */}
      {clearApiKey.error && (
        <p className="mt-2 text-xs text-red-600">{clearApiKey.error.message}</p>
      )}
      {deleteRelay.error && (
        <p className="mt-2 text-xs text-red-600">{deleteRelay.error.message}</p>
      )}
    </Card>
  );
}
