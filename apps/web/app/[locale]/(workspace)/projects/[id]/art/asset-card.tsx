'use client';
import * as React from 'react';
import { Image as ImageIcon, Shield, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type AssetBrief = {
  id: string;
  name: string;
  type: string;
  alias: string[];
  description: string | null;
  characterRole: string | null;
  tags: string[];
  mainMediaId: string | null;
  complianceStatus: string;
  status: string;
};

interface Props {
  asset: AssetBrief;
  onClick: () => void;
}

export function AssetCard({ asset, onClick }: Props): React.ReactElement {
  return (
    <Card
      onClick={onClick}
      className={cn(
        'flex cursor-pointer flex-col overflow-hidden transition-all',
        'hover:border-[hsl(var(--color-accent))] hover:shadow-md',
      )}
    >
      {/* 主图占位区 */}
      <div className="relative flex aspect-square items-center justify-center bg-[hsl(var(--color-secondary)/0.4)]">
        {asset.mainMediaId ? (
          // W4.5 实装后这里渲染真实图片
          <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
            主形象已生成
          </div>
        ) : (
          <ImageIcon className="size-8 text-[hsl(var(--color-muted-foreground)/0.5)]" />
        )}
        <ComplianceBadge status={asset.complianceStatus} />
        <StatusBadge status={asset.status} />
      </div>

      {/* 卡片底部信息 */}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-sm font-medium">{asset.name}</div>
          {asset.characterRole && (
            <Badge variant="secondary" className="shrink-0 px-1 text-[9px]">
              {asset.characterRole}
            </Badge>
          )}
        </div>
        {asset.alias.length > 0 && (
          <div className="truncate text-[10px] text-[hsl(var(--color-muted-foreground))]">
            @ {asset.alias.join(' / ')}
          </div>
        )}
        {asset.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-[hsl(var(--color-muted-foreground))]">
            {asset.description}
          </p>
        )}
        {asset.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded bg-[hsl(var(--color-secondary)/0.6)] px-1.5 py-0.5 text-[9px] text-[hsl(var(--color-muted-foreground))]"
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
      </div>
    </Card>
  );
}

function ComplianceBadge({ status }: { status: string }): React.ReactElement | null {
  if (status === 'NOT_REQUIRED') return null;
  if (status === 'APPROVED') {
    return (
      <div
        title="合规已通过"
        className="absolute right-1.5 top-1.5 rounded-full bg-[hsl(var(--color-success,142_71%_45%))/0.15] p-0.5 text-[hsl(var(--color-success,142_71%_45%))]"
      >
        <Shield className="size-3" />
      </div>
    );
  }
  return (
    <div
      title={`合规: ${status}`}
      className="absolute right-1.5 top-1.5 rounded-full bg-[hsl(var(--color-warning,40_92%_50%))/0.15] p-0.5 text-[hsl(var(--color-warning,40_92%_50%))]"
    >
      <ShieldAlert className="size-3" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const variant: 'secondary' | 'success' | 'default' =
    status === 'CONFIRMED' ? 'success' : status === 'DRAFT' ? 'secondary' : 'default';
  return (
    <Badge variant={variant} className="absolute left-1.5 top-1.5 px-1 text-[9px]">
      {status}
    </Badge>
  );
}
