'use client';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';

export interface BindDialogProps {
  groupId: string;
  locale: string;
  projectId: string;
  onClose: () => void;
  onBind: (
    assetId: string,
    usageType?:
      | 'APPEAR'
      | 'SPEAK'
      | 'HOLD'
      | 'WEAR'
      | 'ENVIRONMENT'
      | 'BACKGROUND'
      | 'SOUND_BG'
      | 'SOUND_VOICE'
      | 'THEME'
      | 'REFERENCE',
  ) => void;
}

export function BindAssetDialog({
  groupId,
  locale,
  projectId,
  onClose,
  onBind,
}: BindDialogProps): React.ReactElement {
  const [typeFilter, setTypeFilter] = React.useState<
    'ALL' | 'CHARACTER' | 'SCENE' | 'PROP'
  >('ALL');
  const { data: assets, isLoading } = trpc.aigc.listAvailableAssets.useQuery({
    groupId,
    type: typeFilter === 'ALL' ? undefined : typeFilter,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-[hsl(var(--color-card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-5 py-3">
          <h3 className="text-sm font-semibold">关联素材到本生成段</h3>
          <button
            onClick={onClose}
            className="text-sm text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]"
          >
            ✕
          </button>
        </header>
        <div className="flex gap-2 border-b border-[hsl(var(--color-border))] px-5 py-2">
          {(['ALL', 'CHARACTER', 'SCENE', 'PROP'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-md px-3 py-1 text-xs ${
                typeFilter === t
                  ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                  : 'hover:bg-[hsl(var(--color-muted))]'
              }`}
            >
              {t === 'ALL' ? '全部' : t === 'CHARACTER' ? '人物' : t === 'SCENE' ? '场景' : '道具'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
          ) : assets && assets.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-5">
              {assets.map((a) => (
                <button
                  key={a.id}
                  disabled={a.alreadyBound}
                  onClick={() => onBind(a.id)}
                  className={`group flex flex-col overflow-hidden rounded-md border border-[hsl(var(--color-border))] text-left transition ${
                    a.alreadyBound
                      ? 'opacity-40'
                      : 'hover:border-blue-500'
                  }`}
                  title={
                    a.alreadyBound ? '已关联到本生成段' : `点击关联 — ${a.description ?? ''}`
                  }
                >
                  <div className="relative aspect-square bg-[hsl(var(--color-muted))]">
                    {a.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.thumbnailUrl}
                        alt={a.name}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
                        无图
                      </div>
                    )}
                    {a.alreadyBound && (
                      <span className="absolute right-1 top-1 rounded bg-green-600/90 px-1.5 py-0.5 text-[10px] text-white">
                        已关联
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="truncate text-xs font-medium">{a.name}</div>
                    <div className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {a.type} · {a.maturity?.replace(/_.*/, '')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
              本项目没有可用资产 — 去{' '}
              <a className="underline" href={`/${locale}/projects/${projectId}/art`}>
                美术工作台
              </a>{' '}
              创建
            </div>
          )}
        </div>
        <footer className="border-t border-[hsl(var(--color-border))] px-5 py-2 text-xs text-[hsl(var(--color-muted-foreground))]">
          usageType 自动按 asset.type 推导(CHARACTER→APPEAR / SCENE→ENVIRONMENT / PROP→APPEAR)。
          需要别的(SPEAK/HOLD/SOUND_VOICE 等)请用 API 或下版本 UI。
        </footer>
      </div>
    </div>
  );
}
