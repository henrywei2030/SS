'use client';
import { Loader2, Plus } from 'lucide-react';
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

import type { Catalog } from './providers-shared';

// ============================================================================
// 子组件:添加中转站凭证
// ============================================================================

export function AddRelayDialog({
  catalogs,
  existingNames,
  onClose,
  onSaved,
}: {
  catalogs: Catalog[];
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [name, setName] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [apiUrl, setApiUrl] = React.useState('');
  const [catalogKey, setCatalogKey] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const create = trpc.admin.relay.create.useMutation({ onSuccess: onSaved });

  // 选 catalog 后自动填 displayName + apiUrl
  React.useEffect(() => {
    if (!catalogKey) return;
    const c = catalogs.find((x) => x.name === catalogKey);
    if (!c) return;
    if (!displayName) setDisplayName(c.displayName);
    if (!apiUrl) setApiUrl(c.defaultApiUrl);
    if (!name) setName(catalogKey);
  }, [catalogKey, catalogs, displayName, apiUrl, name]);

  const canSubmit =
    name.length >= 2 &&
    displayName.length >= 1 &&
    !existingNames.includes(name) &&
    !create.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>📦 添加中转站凭证</DialogTitle>
          <DialogDescription>
            添加新中转站后,可从其 catalog 选模型添加到列表 · 同 token 共享多模型
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>选择 catalog(可选,自动填默认 URL)</Label>
            <select
              value={catalogKey}
              onChange={(e) => setCatalogKey(e.target.value)}
              className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-1.5 text-sm"
            >
              <option value="">(自定义,无 catalog)</option>
              {catalogs.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.displayName} · {c.totalModels} 模型
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="r-name">name(唯一标识)</Label>
              <Input
                id="r-name"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="relay-prod / poe-personal"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-display">显示名</Label>
              <Input
                id="r-display"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="主用中转站 / 备用 OpenRouter"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="r-url">Base URL</Label>
            <Input
              id="r-url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://your-relay/v1"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              创建后再去卡片上"设置 API Key"(分两步,防误存空 token)
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="r-notes">备注(可选)</Label>
            <Input
              id="r-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="¥10 月限额 / 备用 token / 等"
            />
          </div>

          {existingNames.includes(name) && (
            <p className="text-xs text-red-600">name "{name}" 已存在</p>
          )}
          {create.error && (
            <p className="rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-700">
              {create.error.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() =>
              create.mutate({
                name,
                displayName,
                apiUrl: apiUrl || undefined,
                catalogKey: catalogKey || undefined,
                notes: notes || undefined,
              })
            }
            disabled={!canSubmit}
          >
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
