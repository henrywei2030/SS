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
  CheckCircle2,
  Lock,
  ChevronRight,
} from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
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

  // v0.2.0 向导式流水线:用 pipelineStatus 给每阶段标状态(✓完成 / 🔒锁定)。
  //   锁定=前序未就绪(如拆解需先有分镜脚本快照),仍可点进去 — pane 内有明确引导,不硬挡。
  const { data: pipeline } = trpc.storyboard.pipelineStatus.useQuery({ projectId });
  const stageStatus: Record<TabKey, 'done' | 'locked' | undefined> = {
    inspiration: pipeline?.inspiration.done ? 'done' : undefined,
    script: pipeline?.script.done ? 'done' : undefined,
    shots: pipeline?.generate.done ? 'done' : undefined,
    breakdown: pipeline
      ? pipeline.breakdown.done
        ? 'done'
        : pipeline.export.hasSnapshot
          ? undefined
          : 'locked'
      : undefined,
  };

  return (
    <div className="flex h-11 items-center justify-between border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3">
      {/* v0.2.0 流水线顺序:灵感创作 → 剧本管理 → 分镜工坊 → 剧本拆解(拆解吃分镜脚本,故在分镜之后) */}
      <div className="flex items-center gap-1">
        <TabButton
          active={tab === 'inspiration'}
          onClick={() => onTabChange('inspiration')}
          icon={<Lightbulb className="size-3.5" />}
          status={stageStatus.inspiration}
        >
          灵感创作
        </TabButton>
        <StageArrow />
        <TabButton
          active={tab === 'script'}
          onClick={() => onTabChange('script')}
          icon={<FileText className="size-3.5" />}
          status={stageStatus.script}
        >
          剧本管理
        </TabButton>
        <StageArrow />
        <TabButton
          active={tab === 'shots'}
          onClick={() => onTabChange('shots')}
          icon={<ListChecks className="size-3.5" />}
          status={stageStatus.shots}
        >
          分镜工坊
        </TabButton>
        <StageArrow />
        {/* v0.2.0:剧本拆解移到分镜之后 — 拆解输入=分镜工坊导出的分镜脚本快照 */}
        <TabButton
          active={tab === 'breakdown'}
          onClick={() => onTabChange('breakdown')}
          icon={<Users className="size-3.5" />}
          status={stageStatus.breakdown}
        >
          剧本拆解
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
  status,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  /** v0.2.0 流水线阶段状态:done=已就绪✓ / locked=前序未就绪🔒(仍可点,pane 内有引导) */
  status?: 'done' | 'locked';
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
      {status === 'done' && (
        <CheckCircle2 className="size-3 text-[hsl(var(--color-success))]" aria-label="已就绪" />
      )}
      {status === 'locked' && (
        <Lock className="size-3 text-[hsl(var(--color-muted-foreground)/0.7)]" aria-label="前序未就绪" />
      )}
    </button>
  );
}

// v0.2.0:阶段间箭头 — 把四个 tab 串成「向导式流水线」的视觉流向
function StageArrow(): React.ReactElement {
  return (
    <ChevronRight
      className="size-3 shrink-0 text-[hsl(var(--color-muted-foreground)/0.4)]"
      aria-hidden
    />
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
