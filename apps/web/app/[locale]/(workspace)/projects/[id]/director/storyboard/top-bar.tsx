'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  FileText,
  ListChecks,
  Minus,
  Plus,
  Compass,
  Lightbulb,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ScriptActions } from './top-bar-script-actions';
import { ShotsActions, ShotsProgress } from './top-bar-shots-actions';

// 五六收工:加 'breakdown' tab
type TabKey = 'inspiration' | 'script' | 'breakdown' | 'shots';

interface Props {
  projectId: string;
  episodeId: string | undefined;
  episodeNumber: number | undefined;
  tab: TabKey;
  onTabChange: (t: TabKey) => void;
  fontSize: number;
  onFontSizeChange: (delta: 1 | -1) => void;
  onAfterAction: () => void;
}

export function TopBar({
  projectId,
  episodeId,
  episodeNumber,
  tab,
  onTabChange,
  fontSize,
  onFontSizeChange,
  onAfterAction,
}: Props): React.ReactElement {
  // 三十六收工 UX 改造:剧本分析按钮入口在剧本 tab(原"导演台首页"卡片入口已删)
  // P0 修:locale fallback 改 'zh-CN' 跟项目其他地方一致(原 'zh' 跟 next-intl 路由不匹配 → 404)
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'zh-CN';
  return (
    <div className="flex h-11 items-center justify-between border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3">
      {/* tab 切换 — 灵感创作在最左(想法→生成剧本的源头) */}
      <div className="flex items-center gap-1">
        <TabButton
          active={tab === 'inspiration'}
          onClick={() => onTabChange('inspiration')}
          icon={<Lightbulb className="size-3.5" />}
        >
          灵感创作
        </TabButton>
        <TabButton
          active={tab === 'script'}
          onClick={() => onTabChange('script')}
          icon={<FileText className="size-3.5" />}
        >
          剧本管理
        </TabButton>
        {/* 五六收工:剧本拆解 — 纯文字定稿(人物档案 / 关联),美术工坊负责生图 */}
        <TabButton
          active={tab === 'breakdown'}
          onClick={() => onTabChange('breakdown')}
          icon={<Users className="size-3.5" />}
        >
          剧本拆解
        </TabButton>
        <TabButton
          active={tab === 'shots'}
          onClick={() => onTabChange('shots')}
          icon={<ListChecks className="size-3.5" />}
        >
          分镜工坊
        </TabButton>
      </div>

      {/* 右侧按钮区 — tab 决定显示哪些按钮 */}
      <div className="flex items-center gap-2">
        {tab === 'shots' && episodeId && <ShotsProgress episodeId={episodeId} />}
        {tab === 'script' && (
          <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <Link href={`/${locale}/projects/${projectId}/director/analysis`}>
              <Compass className="size-3.5" />
              剧本分析
            </Link>
          </Button>
        )}
        {tab === 'script' ? (
          <ScriptActions
            projectId={projectId}
            currentEpisodeNumber={episodeNumber}
            onSaved={onAfterAction}
          />
        ) : tab === 'shots' ? (
          <ShotsActions
            projectId={projectId}
            episodeId={episodeId}
            episodeNumber={episodeNumber}
            onAfterAction={onAfterAction}
          />
        ) : null}
        {tab === 'shots' && (
          <FontSizeControl fontSize={fontSize} onChange={onFontSizeChange} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors',
        active
          ? 'bg-[hsl(var(--color-accent)/0.12)] font-medium text-[hsl(var(--color-accent))] shadow-sm'
          : 'text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 字号
// ---------------------------------------------------------------------------

function FontSizeControl({
  fontSize,
  onChange,
}: {
  fontSize: number;
  onChange: (delta: 1 | -1) => void;
}): React.ReactElement {
  return (
    <div className="ml-1 flex items-center gap-0.5 rounded border border-[hsl(var(--color-border))] px-0.5">
      <button
        onClick={() => onChange(-1)}
        className="flex size-6 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
        title="缩小字号"
      >
        <Minus className="size-3" />
      </button>
      <span className="w-6 text-center font-mono text-[10px] text-[hsl(var(--color-muted-foreground))]">
        {fontSize}
      </span>
      <button
        onClick={() => onChange(1)}
        className="flex size-6 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
        title="放大字号"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}
