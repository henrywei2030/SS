'use client';
import * as React from 'react';
import { Image as ImageIcon, Shield, ShieldAlert, Lock } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';

import { characterNeedsVoice } from '@ss/shared';
import type { AppRouter } from '@ss/api';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Binding = inferRouterOutputs<AppRouter>['asset']['listBindings'][number];

type AssetBrief = {
  id: string;
  name: string;
  type: string;
  alias: string[];
  description: string | null;
  characterRole: string | null;
  tags: string[];
  archetypeKey: string | null;
  importance: string | null;
  maturity: string;
  status: string;
  complianceStatus: string;
  lockedAt: Date | null;

  // 槽位
  portraitMediaId: string | null;
  threeViewMediaId: string | null;
  sceneMainMediaId: string | null;
  sceneFrontMediaId: string | null;
  sceneLeftMediaId: string | null;
  sceneRightMediaId: string | null;
  sceneBackMediaId: string | null;
  panoramaMediaId: string | null;
  mainMediaId: string | null;
  // 六八:人物声音关联状态(卡片 chip 用)
  voiceMediaId: string | null;
};

interface Props {
  asset: AssetBrief;
  /** 主形象 URL — 由父组件从 mediaMap 查好传入,避免 N+1 */
  heroUrl?: string | null;
  /** W6 polish:出场绑定从父级 batch query 传入(原本卡片内 useQuery 是 N+1) */
  bindings: Binding[];
  onClick: () => void;
}

export function AssetCard({ asset, heroUrl, bindings, onClick }: Props): React.ReactElement {
  const episodeBadges = React.useMemo(() => {
    const byEp = new Map<number, string[]>();
    for (const b of bindings) {
      const epNo = b.episode.number;
      const sceneNo = b.scene?.number ?? '';
      const label = sceneNo || String(epNo);
      const list = byEp.get(epNo) ?? [];
      if (!list.includes(label)) list.push(label);
      byEp.set(epNo, list);
    }
    return Array.from(byEp.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ep, labels]) => ({
        episode: ep,
        label: labels[0] ?? String(ep),
        moreCount: Math.max(0, labels.length - 1),
      }));
  }, [bindings]);

  // 主形象 — 9:16 用 portrait,场景用 sceneMain or main,道具用 main
  const heroMediaId =
    asset.type === 'CHARACTER'
      ? asset.portraitMediaId
      : asset.type === 'SCENE'
        ? asset.sceneMainMediaId ?? asset.mainMediaId
        : asset.mainMediaId;

  // 卡片比例 — 人物 9:16,场景/道具 16:9
  // 五七-3:紧凑视图 — 人物卡缩略用 3:4(原 9:16 太高),场景/道具 16:9
  const aspectClass = asset.type === 'CHARACTER' ? 'aspect-[3/4]' : 'aspect-[16/9]';

  // 主标签 — 优先角色 > importance > type
  const primaryBadge =
    asset.characterRole ??
    (asset.importance ? `${asset.importance} 级` : null);

  return (
    <Card
      onClick={onClick}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden transition-all',
        'hover:border-[hsl(var(--color-accent))] hover:shadow-md',
      )}
    >
      {/* 主图区 */}
      <div
        className={cn(
          'relative flex items-center justify-center bg-[hsl(var(--color-secondary)/0.4)]',
          aspectClass,
        )}
      >
        {heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroUrl}
            alt={asset.name}
            loading="lazy"
            onError={(e) => {
              // 图源(CDN/picsum)挂了时降级为图标占位,不显示 broken-image
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
            className="absolute inset-0 size-full object-cover"
          />
        ) : heroMediaId ? (
          <div className="flex flex-col items-center gap-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">
            <ImageIcon className="size-6 opacity-50" />
            主形象已生成
          </div>
        ) : (
          <ImageIcon className="size-8 text-[hsl(var(--color-muted-foreground)/0.4)]" />
        )}

        {/* 左上 — 角色身份 / importance */}
        {primaryBadge && (
          <Badge variant="default" className="absolute left-1.5 top-1.5 px-1.5 text-[10px]">
            {primaryBadge}
          </Badge>
        )}

        {/* 右上 — 合规 + 锁定 */}
        <div className="absolute right-1.5 top-1.5 flex gap-1">
          {asset.lockedAt && (
            <div
              title="资产已锁定"
              className="rounded-full bg-[hsl(var(--color-accent)/0.15)] p-0.5 text-[hsl(var(--color-accent))]"
            >
              <Lock className="size-3" />
            </div>
          )}
          <ComplianceBadge status={asset.complianceStatus} />
        </div>

        {/* 底部 — 状态标签条 */}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5">
          <MaturityChips asset={asset} />
        </div>
      </div>

      {/* 卡片底部信息 */}
      <div className="flex flex-col gap-0.5 p-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-[12px] font-medium">{asset.name}</div>
          {asset.archetypeKey && asset.archetypeKey !== asset.name && (
            <span
              title={`原型:${asset.archetypeKey}`}
              className="shrink-0 text-[9px] text-[hsl(var(--color-muted-foreground))]"
            >
              ·{asset.archetypeKey}
            </span>
          )}
        </div>
        {asset.alias.length > 0 && (
          <div className="truncate text-[10px] text-[hsl(var(--color-muted-foreground))]">
            @ {asset.alias.join(' / ')}
          </div>
        )}
        {asset.description && (
          <p className="line-clamp-1 text-[10px] leading-relaxed text-[hsl(var(--color-muted-foreground))]">
            {asset.description}
          </p>
        )}
        {asset.tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded bg-[hsl(var(--color-secondary)/0.6)] px-1 py-0.5 text-[9px] text-[hsl(var(--color-muted-foreground))]"
              >
                {t}
              </span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-[9px] text-[hsl(var(--color-muted-foreground))]">
                +{asset.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* 出场集联动 — group by episode */}
        {episodeBadges.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 border-t border-[hsl(var(--color-border)/0.5)] pt-1.5">
            {episodeBadges.slice(0, 6).map((ep) => (
              <span
                key={ep.episode}
                className="rounded bg-[hsl(var(--color-accent)/0.12)] px-1 py-0.5 text-[9px] text-[hsl(var(--color-accent))]"
                title={`第 ${ep.episode} 集`}
              >
                {ep.label}
              </span>
            ))}
            {episodeBadges.length > 6 && (
              <span className="text-[9px] text-[hsl(var(--color-muted-foreground))]">
                +{episodeBadges.length - 6}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 状态标签 — L0-L5 直接显示对应"形象图已完成/三视图未完成/合规通过"
// ---------------------------------------------------------------------------

function MaturityChips({ asset }: { asset: AssetBrief }): React.ReactElement {
  const chips: Array<{ label: string; tone: 'success' | 'warn' | 'default' }> = [];

  if (asset.type === 'CHARACTER') {
    chips.push(
      asset.portraitMediaId
        ? { label: '形象图已完成', tone: 'success' }
        : { label: '形象图未完成', tone: 'warn' },
    );
    if (asset.complianceStatus === 'APPROVED') {
      chips.push({ label: '三视图已合规', tone: 'success' });
    } else if (asset.threeViewMediaId) {
      chips.push({ label: '三视图待合规', tone: 'warn' });
    } else {
      chips.push({ label: '三视图未完成', tone: 'warn' });
    }
    // 六八:声音关联状态 — 只对需要声线的角色(主演/配角)显示;群演不需要不标
    if (characterNeedsVoice(asset.characterRole)) {
      chips.push(
        asset.voiceMediaId
          ? { label: '声音已关联', tone: 'success' }
          : { label: '未关联声音', tone: 'warn' },
      );
    } else if (asset.voiceMediaId) {
      // 群演/未分类被手动配了声线 → 仍如实显示(生成时会附带)
      chips.push({ label: '声音已关联', tone: 'success' });
    }
  } else if (asset.type === 'SCENE') {
    // 六八:场景视图体系收敛为 主视角 / 九宫格(threeViewMediaId 复用) / 360° 全景
    const hasMain = !!asset.sceneMainMediaId || !!asset.mainMediaId;
    chips.push(
      hasMain
        ? { label: '主视角已完成', tone: 'success' }
        : { label: '主视角未完成', tone: 'warn' },
    );
    chips.push(
      asset.threeViewMediaId
        ? { label: '九宫格已完成', tone: 'success' }
        : { label: '九宫格未完成', tone: 'warn' },
    );
    chips.push(
      asset.panoramaMediaId
        ? { label: '全景已完成', tone: 'success' }
        : { label: '全景未完成', tone: 'warn' },
    );
  } else {
    chips.push(
      asset.mainMediaId
        ? { label: '已确认', tone: 'success' }
        : { label: '未生成', tone: 'warn' },
    );
  }

  return (
    <>
      {chips.map((c, i) => (
        <span
          key={i}
          className={cn(
            'rounded px-1 py-0.5 text-[9px] font-medium',
            c.tone === 'success' &&
              'bg-[hsl(var(--color-success)/0.2)] text-[hsl(var(--color-success))]',
            c.tone === 'warn' &&
              'bg-[hsl(var(--color-warning)/0.2)] text-[hsl(var(--color-warning))]',
            c.tone === 'default' && 'bg-white/20 text-white',
          )}
        >
          {c.label}
        </span>
      ))}
    </>
  );
}

function ComplianceBadge({ status }: { status: string }): React.ReactElement | null {
  if (status === 'NOT_REQUIRED') return null;
  if (status === 'APPROVED') {
    return (
      <div
        title="合规已通过"
        className="rounded-full bg-[hsl(var(--color-success)/0.2)] p-0.5 text-[hsl(var(--color-success))]"
      >
        <Shield className="size-3" />
      </div>
    );
  }
  return (
    <div
      title={`合规: ${status}`}
      className="rounded-full bg-[hsl(var(--color-warning)/0.2)] p-0.5 text-[hsl(var(--color-warning))]"
    >
      <ShieldAlert className="size-3" />
    </div>
  );
}
