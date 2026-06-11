'use client';
/**
 * H3(docs/07):八维提示词知识库管理 — 浏览/筛选/启停/编辑/删除 + MINED 候选审核 + 人改蒸馏。
 * 候选条目(飞轮产出 enabled=false)在这里人工审核启用(D-D 纪律:挖掘永不自动生效)。
 */
import * as React from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const DIMS = [
  'SUBJECT',
  'ACTION',
  'SCENE',
  'LIGHTING',
  'CAMERA',
  'STYLE',
  'QUALITY',
  'CONSTRAINT',
] as const;
type Dim = (typeof DIMS)[number];
const DIM_LABEL: Record<string, string> = {
  SUBJECT: '主体',
  ACTION: '动作',
  SCENE: '场景',
  LIGHTING: '光影',
  CAMERA: '镜头',
  STYLE: '风格',
  QUALITY: '画质',
  CONSTRAINT: '稳定',
};
const SOURCE_LABEL: Record<string, string> = { SEED: '种子', MANUAL: '手录', MINED: '挖掘' };

interface EditDraft {
  id: string | null; // null = 新建
  dimension: Dim;
  title: string;
  content: string;
  keywordsCsv: string;
}

export function KnowledgeManager(): React.ReactElement {
  const utils = trpc.useUtils();
  const [dimension, setDimension] = React.useState<Dim | ''>('');
  const [candidatesOnly, setCandidatesOnly] = React.useState(false);
  const [editDraft, setEditDraft] = React.useState<EditDraft | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<{ id: string; title: string } | null>(
    null,
  );

  const listInput = {
    ...(dimension ? { dimension } : {}),
    ...(candidatesOnly ? { candidatesOnly: true } : {}),
  };
  const { data, isLoading } = trpc.admin.knowledge.list.useQuery(listInput);
  const invalidate = (): void => void utils.admin.knowledge.list.invalidate();

  const setEnabled = trpc.admin.knowledge.setEnabled.useMutation({
    onSuccess: (r) => {
      toast.success(r.enabled ? '已启用(进入检索池)' : '已停用');
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.admin.knowledge.remove.useMutation({
    onSuccess: (r) => {
      toast.success(r.willReseedOnSync ? '已删除(注意:种子条目 db:sync 会补回,建议用停用)' : '已删除');
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.admin.knowledge.create.useMutation({
    onSuccess: () => {
      toast.success('已新建(默认启用)');
      setEditDraft(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.admin.knowledge.update.useMutation({
    onSuccess: () => {
      toast.success('已保存(改过正文的条目会重算向量)');
      setEditDraft(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const mine = trpc.admin.knowledge.mine.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.pairsFound === 0
          ? '没有可蒸馏的「AI→人改」编辑对(先用 ✨ 优化再人工修订,飞轮才有料)'
          : `蒸馏完成:${r.pairsUsed} 对样本 → ${r.candidatesCreated} 条候选(${r.skippedDuplicate} 重复跳过)· ¥${r.costCny.toFixed(3)}`,
      );
      invalidate();
    },
    onError: (e) => toast.error(`蒸馏失败:${e.message}`),
  });

  const saveDraft = (): void => {
    if (!editDraft) return;
    if (!editDraft.title.trim() || !editDraft.content.trim()) {
      toast.error('标题与内容必填');
      return;
    }
    const payload = {
      dimension: editDraft.dimension,
      title: editDraft.title.trim(),
      content: editDraft.content.trim(),
      keywordsCsv: editDraft.keywordsCsv,
    };
    if (editDraft.id) update.mutate({ id: editDraft.id, ...payload });
    else create.mutate(payload);
  };

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">提示词知识库</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            八维语料(优化器/分镜生成检索注入)— 候选条目须在此审核启用;权重随真打 QC 数据升降
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() =>
              setEditDraft({ id: null, dimension: 'ACTION', title: '', content: '', keywordsCsv: '' })
            }
            className="rounded border border-[hsl(var(--color-border))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--color-muted))]"
          >
            ＋ 新建条目
          </button>
          <button
            onClick={() => mine.mutate({})}
            disabled={mine.isPending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title="扫描「✨AI 优化写回 → 人工再修改」的编辑对,LLM 提炼可泛化规则入候选(需配判官或优化器 binding)"
          >
            {mine.isPending ? '⛏️ 蒸馏中…' : '⛏️ 蒸馏人改候选'}
          </button>
        </div>
      </header>

      {/* 概览 + 筛选 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {data && (
          <span className="text-[hsl(var(--color-muted-foreground))]">
            共 {data.summary.total} 条 · 启用 {data.summary.enabled} ·
            <button
              onClick={() => setCandidatesOnly((v) => !v)}
              className={`ml-1 rounded border px-1.5 py-0.5 text-xs ${
                candidatesOnly
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                  : 'border-[hsl(var(--color-border))]'
              }`}
            >
              待审核候选 {data.summary.candidates}
            </button>
          </span>
        )}
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value as Dim | '')}
          className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1 text-sm"
        >
          <option value="">全部维度</option>
          {DIMS.map((d) => (
            <option key={d} value={d}>
              {DIM_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[hsl(var(--color-border))]">
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--color-muted))] text-left text-xs text-[hsl(var(--color-muted-foreground))]">
              <tr>
                <th className="px-2 py-1.5">维度</th>
                <th className="px-2 py-1.5">标题</th>
                <th className="px-2 py-1.5">内容</th>
                <th className="px-2 py-1.5">来源</th>
                <th className="px-2 py-1.5" title="飞轮权重(qc 相关性升降,1=初始)">权重</th>
                <th className="px-2 py-1.5" title="检索命中次数">命中</th>
                <th className="px-2 py-1.5">状态</th>
                <th className="px-2 py-1.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.entries.map((e) => {
                const keywords = Array.isArray((e.tagsJson as { keywords?: unknown })?.keywords)
                  ? ((e.tagsJson as { keywords: string[] }).keywords ?? []).join(',')
                  : '';
                return (
                  <tr
                    key={e.id}
                    className={`border-t border-[hsl(var(--color-border))] ${e.enabled ? '' : 'opacity-60'}`}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap">{DIM_LABEL[e.dimension] ?? e.dimension}</td>
                    <td className="max-w-[12rem] px-2 py-1.5">{e.title}</td>
                    <td className="max-w-[28rem] px-2 py-1.5 text-xs leading-relaxed" title={e.content}>
                      {e.content.length > 80 ? `${e.content.slice(0, 80)}…` : e.content}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span
                        className={`rounded border px-1 text-xs ${
                          e.source === 'MINED'
                            ? 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                            : 'border-[hsl(var(--color-border))] text-[hsl(var(--color-muted-foreground))]'
                        }`}
                      >
                        {SOURCE_LABEL[e.source] ?? e.source}
                      </span>
                      {e.projectId && <span className="ml-1 text-xs" title="项目私有(世界观)">📌</span>}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{e.weight.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-xs">{e.hitCount}</td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => setEnabled.mutate({ id: e.id, enabled: !e.enabled })}
                        disabled={setEnabled.isPending}
                        className={`rounded border px-1.5 py-0.5 text-xs ${
                          e.enabled
                            ? 'border-emerald-600/50 text-emerald-600 dark:text-emerald-400'
                            : 'border-[hsl(var(--color-border))] text-[hsl(var(--color-muted-foreground))]'
                        }`}
                      >
                        {e.enabled ? '启用中' : e.source === 'MINED' ? '待审核' : '已停用'}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <button
                        onClick={() =>
                          setEditDraft({
                            id: e.id,
                            dimension: e.dimension as Dim,
                            title: e.title,
                            content: e.content,
                            keywordsCsv: keywords,
                          })
                        }
                        className="rounded border border-[hsl(var(--color-border))] px-1.5 py-0.5 text-xs hover:bg-[hsl(var(--color-muted))]"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setRemoveTarget({ id: e.id, title: e.title })}
                        className="ml-1 rounded border border-red-500/40 px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data && data.entries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
                    {candidatesOnly ? '没有待审核候选 — 点「⛏️ 蒸馏人改候选」或等 QC 漂移沉淀' : '无条目'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 编辑/新建 */}
      {editDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-semibold">{editDraft.id ? '编辑条目' : '新建条目'}</h2>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs text-[hsl(var(--color-muted-foreground))]">维度</span>
                <select
                  value={editDraft.dimension}
                  onChange={(e) => setEditDraft({ ...editDraft, dimension: e.target.value as Dim })}
                  className="mt-1 w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5"
                >
                  {DIMS.map((d) => (
                    <option key={d} value={d}>
                      {DIM_LABEL[d]}({d})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[hsl(var(--color-muted-foreground))]">标题(≤40 字)</span>
                <input
                  value={editDraft.title}
                  onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                  className="mt-1 w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                  内容(注入提示词上下文的语料/规则,≤500 字;改动会触发向量重算)
                </span>
                <textarea
                  value={editDraft.content}
                  onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                  className="mt-1 min-h-[6rem] w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 leading-relaxed"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                  关键词(逗号分隔,降级链按正文匹配;留空 = 通用条目)
                </span>
                <input
                  value={editDraft.keywordsCsv}
                  onChange={(e) => setEditDraft({ ...editDraft, keywordsCsv: e.target.value })}
                  className="mt-1 w-full rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5"
                  placeholder="如:夜,月光,深夜"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEditDraft(null)}
                className="rounded border border-[hsl(var(--color-border))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--color-muted))]"
              >
                取消
              </button>
              <button
                onClick={saveDraft}
                disabled={create.isPending || update.isPending}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {create.isPending || update.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <ConfirmDialog
          title={`删除「${removeTarget.title}」?`}
          description="删除后立即退出检索池;种子条目 db:sync 会按 slug 补回(不想要请用停用)"
          confirmLabel="删除"
          danger
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => {
            remove.mutate({ id: removeTarget.id });
            setRemoveTarget(null);
          }}
        />
      )}
    </div>
  );
}
