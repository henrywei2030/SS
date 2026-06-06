'use client';

/**
 * 五六收工 · 资产档案字段共享组件
 *
 * 剧本拆解(导演 script-breakdown-pane)和美术工坊(asset-edit-dialog)共用同一份
 * Asset,档案字段(gender/age/heightCm/mbti/personalityTags/monologue/lifeNodes/voiceLabel)
 * 两边都要展示 + 编辑。抽到这里避免两套 LifeNodesEditor / 类型 drift。
 *
 * 架构定论(五五收工):剧本拆解侧产文字 + AI 生成草案;美术工坊侧可微调,
 *   「最终以美术工坊为准」。两边都是改同一份 Asset,故 UI 组件共享。
 */
import * as React from 'react';
import { Plus, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: '男',
  FEMALE: '女',
  OTHER: '其他',
};

export interface LifeNode {
  year: string;
  title: string;
  desc: string;
}

/**
 * 把 Prisma Json 字段(unknown)安全解析为 {lifeNodes, voiceLabel}。
 * profileJson 是「整体覆盖」语义 —— 读-改-写须全量,否则丢字段。
 */
export function parseProfileJson(raw: unknown): { lifeNodes: LifeNode[]; voiceLabel: string } {
  const obj = (raw ?? {}) as { lifeNodes?: unknown; voiceLabel?: unknown };
  const lifeNodes = Array.isArray(obj.lifeNodes)
    ? obj.lifeNodes
        .map((n): LifeNode | null => {
          if (!n || typeof n !== 'object') return null;
          const r = n as Record<string, unknown>;
          return {
            year: typeof r.year === 'string' ? r.year : String(r.year ?? ''),
            title: typeof r.title === 'string' ? r.title : '',
            desc: typeof r.desc === 'string' ? r.desc : '',
          };
        })
        .filter((n): n is LifeNode => n !== null)
    : [];
  const voiceLabel = typeof obj.voiceLabel === 'string' ? obj.voiceLabel : '';
  return { lifeNodes, voiceLabel };
}

/** 构造回写后端的 profileJson(整体覆盖;空值省略以保持紧凑)*/
export function buildProfileJson(lifeNodes: LifeNode[], voiceLabel: string): {
  lifeNodes?: LifeNode[];
  voiceLabel?: string;
} {
  return {
    ...(lifeNodes.length > 0 ? { lifeNodes } : {}),
    ...(voiceLabel ? { voiceLabel } : {}),
  };
}

// ---------------------------------------------------------------------------
// 人生节点编辑器(年 / 标题 / 描述 行级增删改)
// ---------------------------------------------------------------------------

export function LifeNodesEditor({
  nodes,
  onChange,
  max = 50,
}: {
  nodes: LifeNode[];
  onChange: (nodes: LifeNode[]) => void;
  max?: number;
}): React.ReactElement {
  const inputCls =
    'rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1 text-[11px]';
  const update = (idx: number, patch: Partial<LifeNode>): void => {
    onChange(nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)));
  };
  const remove = (idx: number): void => {
    onChange(nodes.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    if (nodes.length >= max) return;
    onChange([...nodes, { year: '', title: '', desc: '' }]);
  };
  return (
    <div className="space-y-1.5">
      {nodes.map((n, i) => (
        <div
          key={i}
          className="grid grid-cols-[80px_140px_1fr_auto] items-start gap-1 rounded border border-[hsl(var(--color-border))] p-1.5"
        >
          <input
            className={inputCls}
            value={n.year}
            onChange={(e) => update(i, { year: e.target.value.slice(0, 20) })}
            placeholder="2076"
          />
          <input
            className={inputCls}
            value={n.title}
            onChange={(e) => update(i, { title: e.target.value.slice(0, 100) })}
            placeholder="出生 / 入门 / 关键转折"
          />
          <textarea
            className={cn(inputCls, 'min-h-[28px] resize-y')}
            value={n.desc}
            onChange={(e) => update(i, { desc: e.target.value.slice(0, 2000) })}
            placeholder="≤80 字描述"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="flex size-6 items-center justify-center rounded text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-destructive)/0.1)] hover:text-[hsl(var(--color-destructive))]"
            title="移除节点"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={nodes.length >= max}
        className="flex items-center gap-1 text-[10px] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))] disabled:opacity-50"
      >
        <Plus className="size-2.5" />
        加节点 {nodes.length > 0 ? `(${nodes.length}/${max})` : ''}
      </button>
    </div>
  );
}
