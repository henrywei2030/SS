'use client';
import * as React from 'react';
import {
  Loader2,
  ClapperboardIcon,
  Palette,
  Sparkles,
  Settings as SettingsIcon,
  AlertCircle,
} from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

// 三十六收工 UX 改造:按业务模块分组(美术/导演/AIGC/系统)+ 字体调大 + 合并 dropdown
//   原版"当前绑定 + 切换"两列 → 合并成单一 dropdown(显示当前选中,直接改即生效)
//   分组规则按 key 前缀:
//     binding.asset.*     → 美术
//     binding.script.*    → 导演(剧本相关)
//     binding.storyboard.*→ 导演(分镜相关)
//     binding.shot.*      → AIGC(视频生成)
//     其它              → 系统

interface BindingItem {
  key: string;
  value: string;
  description: string | null;
  kind: string;
  options: Array<{ providerId: string; displayName: string; isActive: boolean }>;
}

interface BindingGroup {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  items: BindingItem[];
}

const KIND_LABEL: Record<string, string> = {
  TEXT: 'LLM 文本',
  IMAGE: '图像生成',
  VIDEO: '视频生成',
  AUDIO: '音频',
  COMPLIANCE: '合规',
  EMBEDDING: '向量',
  OTHER: '其它',
};

function groupBindings(items: BindingItem[]): BindingGroup[] {
  const groups: Record<string, BindingItem[]> = {
    art: [],
    director: [],
    aigc: [],
    system: [],
  };

  for (const item of items) {
    if (item.key.startsWith('binding.asset.')) {
      groups.art!.push(item);
    } else if (
      item.key.startsWith('binding.script.') ||
      item.key.startsWith('binding.storyboard.') ||
      item.key.startsWith('binding.inspiration.')
    ) {
      groups.director!.push(item);
    } else if (item.key.startsWith('binding.shot.')) {
      groups.aigc!.push(item);
    } else {
      groups.system!.push(item);
    }
  }

  return [
    {
      title: '导演 · 剧本 & 分镜',
      icon: ClapperboardIcon,
      colorClass: 'text-blue-500',
      items: groups.director!,
    },
    {
      title: '美术 · 资产 & 合规',
      icon: Palette,
      colorClass: 'text-amber-500',
      items: groups.art!,
    },
    {
      title: 'AIGC · 视频生成',
      icon: Sparkles,
      colorClass: 'text-purple-500',
      items: groups.aigc!,
    },
    {
      title: '系统 · 其它绑定',
      icon: SettingsIcon,
      colorClass: 'text-[hsl(var(--color-muted-foreground))]',
      items: groups.system!,
    },
  ].filter((g) => g.items.length > 0);
}

export function BindingsTable(): React.ReactElement {
  const { data, isLoading, refetch } = trpc.admin.binding.list.useQuery();

  if (isLoading) {
    return <Card className="h-64 animate-pulse" />;
  }
  if (!data || data.length === 0) {
    return (
      <Card className="p-8 text-center text-base text-[hsl(var(--color-muted-foreground))]">
        暂无绑定项 — 检查 SystemSetting 是否含 category=&quot;model_binding&quot; 的条目
      </Card>
    );
  }

  const groups = groupBindings(data);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <BindingGroupSection
          key={g.title}
          group={g}
          onSaved={() => void refetch()}
        />
      ))}
    </div>
  );
}

function BindingGroupSection({
  group,
  onSaved,
}: {
  group: BindingGroup;
  onSaved: () => void;
}): React.ReactElement {
  const Icon = group.icon;
  return (
    <Card className="overflow-hidden">
      <header className="flex items-center gap-2 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted)/0.3)] px-5 py-3">
        <Icon className={`size-5 ${group.colorClass}`} />
        <h3 className="text-base font-semibold">{group.title}</h3>
        <span className="ml-auto text-sm text-[hsl(var(--color-muted-foreground))]">
          {group.items.length} 项
        </span>
      </header>
      <div className="divide-y divide-[hsl(var(--color-border)/0.5)]">
        {group.items.map((item) => (
          <BindingRow key={item.key} item={item} onSaved={onSaved} />
        ))}
      </div>
    </Card>
  );
}

function BindingRow({
  item,
  onSaved,
}: {
  item: BindingItem;
  onSaved: () => void;
}): React.ReactElement {
  const setBinding = trpc.admin.binding.set.useMutation({ onSuccess: onSaved });
  const [pending, setPending] = React.useState<string | null>(null);
  const currentProvider = item.options.find((p) => p.providerId === item.value);
  const hasOptions = item.options.length > 0;
  // 当前值不在 options 内(value 是死链接 / Provider 没添加)
  const isOrphan = hasOptions && !currentProvider;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value;
    if (next === item.value) return;
    setPending(next);
    setBinding.mutate(
      { key: item.key, value: next },
      { onSettled: () => setPending(null) },
    );
  };

  return (
    <div className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[1fr_auto] md:gap-4">
      {/* 左侧:key + 描述 + kind badge */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-sm font-medium">{item.key}</code>
          <Badge variant="secondary" className="text-xs">
            {KIND_LABEL[item.kind] ?? item.kind}
          </Badge>
          {currentProvider && !currentProvider.isActive && (
            <Badge variant="destructive" className="text-xs">
              当前 Provider 已停用
            </Badge>
          )}
          {isOrphan && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertCircle className="size-3" />
              {item.value} 不在已注册 Provider
            </Badge>
          )}
        </div>
        {item.description && (
          <p className="mt-1.5 text-sm text-[hsl(var(--color-muted-foreground))]">
            {item.description}
          </p>
        )}
      </div>

      {/* 右侧:合并 dropdown(直接显当前选中 + 切换即生效) */}
      <div className="flex shrink-0 items-center gap-2">
        {hasOptions ? (
          <>
            <select
              value={pending ?? item.value}
              onChange={handleChange}
              disabled={pending !== null}
              className="h-10 min-w-[280px] rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 text-sm font-medium focus:border-[hsl(var(--color-accent))] focus:outline-none disabled:opacity-50"
            >
              {isOrphan && (
                <option value={item.value} disabled>
                  {item.value} (未注册)
                </option>
              )}
              {item.options.map((p) => (
                <option key={p.providerId} value={p.providerId}>
                  {p.displayName}
                  {!p.isActive ? ' (停用)' : ''}
                </option>
              ))}
            </select>
            {pending && (
              <Loader2 className="size-4 animate-spin text-[hsl(var(--color-accent))]" />
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--color-border)/0.5)] bg-[hsl(var(--color-muted)/0.3)] px-3 py-2 text-sm">
            <code className="font-mono">{item.value}</code>
            <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
              (非 LLM · 固定值)
            </span>
          </div>
        )}
      </div>
      {setBinding.error && (
        <p className="col-span-full text-sm text-[hsl(var(--color-destructive))]">
          ⛔ {setBinding.error.message}
        </p>
      )}
    </div>
  );
}
