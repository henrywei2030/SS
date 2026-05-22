'use client';
import * as React from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const KIND_LABEL: Record<string, string> = {
  TEXT: 'LLM 文本',
  IMAGE: '图像生成',
  VIDEO: '视频生成',
  AUDIO: '音频',
  COMPLIANCE: '合规',
  EMBEDDING: '向量',
  OTHER: '其它',
};

export function BindingsTable(): React.ReactElement {
  const { data, isLoading, refetch } = trpc.admin.binding.list.useQuery();

  if (isLoading) {
    return <Card className="h-64 animate-pulse" />;
  }

  return (
    <Card>
      <table className="w-full text-sm">
        <thead className="border-b border-[hsl(var(--color-border))] text-xs text-[hsl(var(--color-muted-foreground))]">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">用途 / Key</th>
            <th className="px-4 py-2.5 text-left font-medium">类型</th>
            <th className="px-4 py-2.5 text-left font-medium">当前绑定</th>
            <th className="px-4 py-2.5 text-right font-medium">切换</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((item) => (
            <BindingRow key={item.key} item={item} onSaved={() => void refetch()} />
          ))}
          {data?.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-[hsl(var(--color-muted-foreground))]">
                暂无绑定项 — 检查 SystemSetting 是否含 category=&quot;model_binding&quot; 的条目
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function BindingRow({
  item,
  onSaved,
}: {
  item: {
    key: string;
    value: string;
    description: string | null;
    kind: string;
    options: Array<{ providerId: string; displayName: string; isActive: boolean }>;
  };
  onSaved: () => void;
}): React.ReactElement {
  const setBinding = trpc.admin.binding.set.useMutation({ onSuccess: onSaved });
  const [pending, setPending] = React.useState<string | null>(null);
  const currentProvider = item.options.find((p) => p.providerId === item.value);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value;
    if (next === item.value) return;
    setPending(next);
    setBinding.mutate(
      { key: item.key, value: next },
      {
        onSettled: () => setPending(null),
      },
    );
  };

  // OTHER 类（如 docx.parser=mammoth）目前不在 ProviderConfig 里 → 不提供下拉,直接显示固定值
  const hasOptions = item.options.length > 0;

  return (
    <tr className="border-b border-[hsl(var(--color-border)/0.5)]">
      <td className="px-4 py-3">
        <div className="font-mono text-xs">{item.key}</div>
        {item.description && (
          <div className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
            {item.description}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant="secondary" className="text-[10px]">
          {KIND_LABEL[item.kind] ?? item.kind}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {currentProvider ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-3.5 text-[hsl(var(--color-success,142_71%_45%))]" />
            <span>{currentProvider.displayName}</span>
            {!currentProvider.isActive && (
              <Badge variant="destructive" className="text-[10px]">
                provider 已停用
              </Badge>
            )}
          </div>
        ) : (
          <span className="font-mono text-xs text-[hsl(var(--color-muted-foreground))]">
            {item.value}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {hasOptions ? (
          <div className="inline-flex items-center gap-2">
            <select
              value={pending ?? item.value}
              onChange={handleChange}
              disabled={pending !== null}
              className="h-8 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 text-sm"
            >
              {item.options.map((p) => (
                <option key={p.providerId} value={p.providerId}>
                  {p.displayName}
                  {!p.isActive ? ' (停用)' : ''}
                </option>
              ))}
            </select>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
          </div>
        ) : (
          <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
            （非 LLM 绑定）
          </span>
        )}
        {setBinding.error && (
          <p className="mt-1 text-xs text-[hsl(var(--color-destructive))]">
            {setBinding.error.message}
          </p>
        )}
      </td>
    </tr>
  );
}
