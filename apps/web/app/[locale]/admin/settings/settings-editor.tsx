'use client';
import * as React from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';

const CATEGORY_LABELS: Record<string, string> = {
  general: '通用业务参数',
  security: '安全 / 认证',
  branding: '品牌',
  feature_flag: '功能开关',
  model_binding: '模型绑定',
  preset: 'UI 预设',
};

const CATEGORY_ORDER = [
  'general',
  'security',
  'feature_flag',
  'model_binding',
  'branding',
  'preset',
];

export function SettingsEditor(): React.ReactElement {
  const utils = trpc.useUtils();
  const {
    data: settings,
    isLoading,
    isError,
    error,
    refetch,
  } = trpc.admin.system.listSettings.useQuery();

  const setSetting = trpc.admin.system.setSetting.useMutation({
    onSuccess: () => {
      toast.success('已保存');
      void utils.admin.system.listSettings.invalidate();
      setEditing(null);
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });

  const [editing, setEditing] = React.useState<{ key: string; value: string } | null>(null);
  const [filter, setFilter] = React.useState('');

  const grouped = React.useMemo(() => {
    const map = new Map<string, NonNullable<typeof settings>>();
    if (!settings) return map;
    const lf = filter.trim().toLowerCase();
    for (const s of settings) {
      if (
        lf &&
        !s.key.toLowerCase().includes(lf) &&
        !(s.description ?? '').toLowerCase().includes(lf)
      ) {
        continue;
      }
      const cat = s.category ?? 'general';
      const list = map.get(cat) ?? [];
      list.push(s);
      map.set(cat, list);
    }
    return map;
  }, [settings, filter]);

  const totalShown = React.useMemo(() => {
    let t = 0;
    for (const list of grouped.values()) t += list.length;
    return t;
  }, [grouped]);

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">系统设置</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            全局 SystemSetting 表:业务参数 / 安全开关 / 模型绑定 / 功能 flag / 品牌
          </p>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索 key / 描述..."
          className="w-64 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-1.5 text-xs"
        />
      </header>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">设置加载失败</div>
          <div className="mt-1 opacity-80">{error?.message}</div>
          <button
            onClick={() => refetch()}
            className="mt-2 rounded border border-red-500/50 px-2 py-1 text-xs hover:bg-red-500/20"
          >
            重试
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
      )}

      <div className="space-y-6">
        {CATEGORY_ORDER.map((cat) => {
          const list = grouped.get(cat);
          if (!list || list.length === 0) return null;
          return (
            <section key={cat}>
              <h2 className="mb-2 text-sm font-semibold">
                {CATEGORY_LABELS[cat] ?? cat}
                <span className="ml-2 text-xs font-normal text-[hsl(var(--color-muted-foreground))]">
                  ({list.length})
                </span>
              </h2>
              <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
                <table className="w-full text-xs">
                  <thead className="bg-[hsl(var(--color-muted))]">
                    <tr>
                      <th className="w-1/3 px-3 py-2 text-left font-medium">Key</th>
                      <th className="px-3 py-2 text-left font-medium">Value</th>
                      <th className="w-1/4 px-3 py-2 text-left font-medium">描述</th>
                      <th className="w-20 px-3 py-2 text-left font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => {
                      const isEditing = editing?.key === s.key;
                      return (
                        <tr
                          key={s.key}
                          className="border-t border-[hsl(var(--color-border))]"
                        >
                          <td className="break-all px-3 py-2 font-mono">
                            {s.key}
                            {s.isSecret && (
                              <span className="ml-1 rounded bg-red-500/20 px-1 text-[9px] text-red-600 dark:text-red-400">
                                SECRET
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <textarea
                                value={editing.value}
                                onChange={(e) =>
                                  setEditing({ key: s.key, value: e.target.value })
                                }
                                className="h-16 w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-2 font-mono text-xs"
                                autoFocus
                              />
                            ) : (
                              <span className="break-all font-mono">{s.value}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[hsl(var(--color-muted-foreground))]">
                            {s.description ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <div className="flex gap-1">
                                <button
                                  onClick={() =>
                                    setSetting.mutate({
                                      key: s.key,
                                      value: editing.value,
                                      category: s.category,
                                      description: s.description ?? undefined,
                                    })
                                  }
                                  disabled={setSetting.isPending}
                                  className="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditing(null)}
                                  className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[10px] hover:bg-[hsl(var(--color-muted))]"
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditing({ key: s.key, value: s.value })}
                                disabled={s.isSecret}
                                title={s.isSecret ? '密钥无法直接编辑' : undefined}
                                className="rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[10px] hover:bg-[hsl(var(--color-muted))] disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                编辑
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        {settings && settings.length > 0 && totalShown === 0 && (
          <div className="rounded-md border border-dashed border-[hsl(var(--color-border))] p-8 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
            没有匹配 &quot;{filter}&quot; 的设置
          </div>
        )}
      </div>
    </div>
  );
}
