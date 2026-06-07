'use client';
import { Eye, EyeOff, Loader2, Plus, Sparkles } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
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

import { KIND_META } from './providers-shared';

// ============================================================================
// 子组件:添加直连 Provider
// ============================================================================

export function AddDirectRow({
  kind,
  onChange,
}: {
  kind: string;
  onChange: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="border-t-4 border-amber-500/40 bg-amber-500/5 px-4 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          className="gap-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <Sparkles className="size-3.5" />+ 添加直连 {KIND_META[kind]?.label}(独立 API Key)
        </Button>
      </div>
      {open && (
        <AddDirectDialog
          kind={kind}
          onClose={() => setOpen(false)}
          onSaved={() => {
            onChange();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function AddDirectDialog({
  kind,
  onClose,
  onSaved,
}: {
  kind: string;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  // Phase 1.5.2 简化(只 4 字段):displayName / baseUrl / apiKey / notes
  // providerId / protocol / 单价 / 单位 自动生成 — 用户后续可在 admin/api-usage 看真实消费
  const [displayName, setDisplayName] = React.useState('');
  const [apiUrl, setApiUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  // Audit 修(F-P0-1):统一 saving 状态防三连 mutation 中按钮解禁导致重复点
  const [saving, setSaving] = React.useState(false);
  // Audit 修(F-P0-2):显式承接 setKey/setActive 失败信息(原代码 catch 静默吞)
  const [extraError, setExtraError] = React.useState<string | null>(null);

  const create = trpc.admin.provider.create.useMutation();
  const setKey = trpc.admin.provider.setApiKey.useMutation();
  const setActive = trpc.admin.provider.setActive.useMutation();

  // 自动生成 providerId:displayName slug + kind 后缀(防重)
  const autoProviderId = React.useMemo(() => {
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return slug ? `direct-${slug}` : '';
  }, [displayName]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setExtraError(null);
    try {
      const providerId = autoProviderId;
      await create.mutateAsync({
        providerId,
        displayName,
        kind: kind as 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'COMPLIANCE' | 'EMBEDDING',
        apiUrl,
        unitPriceCny: 0, // 直连默认 0(不入 cost ledger 精确计费,后续 admin/api-usage 看真实消费)
        unitName: 'ktoken',
        defaultParams: {
          protocol: 'openai-compat', // 99% 直连用 openai-compat 兼容协议
          source: 'direct',
          ...(notes ? { notes } : {}),
        },
      });
      if (apiKey.length >= 8) {
        try {
          await setKey.mutateAsync({ providerId, apiKey });
          await setActive.mutateAsync({ providerId, isActive: true });
        } catch (e) {
          // create 成功但 setKey/setActive 失败:UI 显示但不阻止"已创建"状态(用户可重设)
          setExtraError(
            `Provider 已创建但启用失败:${e instanceof Error ? e.message : String(e)} · 请去列表手动设置 Key + 启用`,
          );
        }
      }
      onSaved();
    } catch {
      // create.error 已显示
    } finally {
      setSaving(false);
    }
  };

  const canSubmit =
    displayName.length >= 1 &&
    apiUrl.length >= 1 &&
    autoProviderId.length >= 3 &&
    !saving;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>⭐ 添加直连 {KIND_META[kind]?.label}</DialogTitle>
          <DialogDescription>
            独立 API Key · 4 字段即可(其他参数自动生成)
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="d-name">显示名称 *</Label>
            <Input
              id="d-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Claude Opus 4.7(Anthropic 直连)"
              autoFocus
            />
            {autoProviderId && (
              <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                自动生成 providerId:<code className="font-mono">{autoProviderId}</code>
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-url">Base URL *</Label>
            <Input
              id="d-url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api.anthropic.com/v1"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-key">API Key</Label>
            <div className="flex gap-1">
              <Input
                id="d-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-... (可空,创建后再设)"
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0 px-2"
              >
                {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </Button>
            </div>
            <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              ≥ 8 字符立即启用 · 空则创建后停用状态(可后续设置)
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="d-notes">备注(可选)</Label>
            <Input
              id="d-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="¥10 月限额 / 主用 / 备用 / 等"
            />
          </div>

          {create.error && (
            <p className="rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-700">
              {create.error.message}
            </p>
          )}
          {/* Audit 修(F-P0-2):setKey/setActive 失败也展示 */}
          {extraError && (
            <p className="rounded-md bg-amber-500/15 px-3 py-2 text-xs text-amber-700">
              {extraError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            创建{apiKey.length >= 8 ? ' + 启用' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
