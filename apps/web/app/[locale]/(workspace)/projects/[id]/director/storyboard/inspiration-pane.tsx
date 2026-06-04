'use client';
import * as React from 'react';
import { toast } from 'sonner';
import {
  Lightbulb,
  Loader2,
  Plus,
  Sparkles,
  Download,
  Trash2,
  Wand2,
  FileDown,
  Pin,
} from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// 跟 router 写入格式对齐(Prisma Json 字段前端拿到是 unknown)
interface OutlineEp {
  number: number;
  title: string;
  synopsis: string;
}
interface DraftEp {
  number: number;
  title: string;
  content: string;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  OUTLINE_DONE: '大纲已生成',
  DONE: '全部展开',
};

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function InspirationPane({ projectId }: { projectId: string }): React.ReactElement {
  const utils = trpc.useUtils();
  const togglePin = trpc.inspiration.togglePin.useMutation({
    onSuccess: () => void utils.inspiration.listDrafts.invalidate({ projectId }),
    onError: (e) => toast.error(`顶置失败:${e.message}`),
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'new' | 'detail'>('new');
  const didInit = React.useRef(false);

  const { data: drafts, isLoading } = trpc.inspiration.listDrafts.useQuery({ projectId });

  // 需求1a 修:首次加载有草稿 → 选第一个进详情。用 didInit ref 只跑一次,
  //   否则用户点"新建"(setMode('new')+清 selectedId)会被本 effect 立即拉回第一个草稿,新建窗口打不开。
  React.useEffect(() => {
    if (!didInit.current && drafts !== undefined) {
      didInit.current = true;
      if (drafts.length > 0) {
        setSelectedId(drafts[0]!.id);
        setMode('detail');
      }
    }
  }, [drafts]);

  const openNew = (): void => {
    setSelectedId(null);
    setMode('new');
  };
  const openDraft = (id: string): void => {
    setSelectedId(id);
    setMode('detail');
  };

  return (
    <div className="flex h-full min-h-0">
      {/* 左:草稿列表 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[hsl(var(--color-border))]">
        <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-3 py-2">
          <span className="text-xs font-medium text-[hsl(var(--color-muted-foreground))]">
            灵感草稿
          </span>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
          >
            <Plus className="size-3" />
            新建
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {isLoading && (
            <div className="p-3 text-xs text-[hsl(var(--color-muted-foreground))]">加载中...</div>
          )}
          {drafts && drafts.length === 0 && (
            <div className="p-3 text-xs text-[hsl(var(--color-muted-foreground))]">
              还没有灵感草稿 — 点"新建"用想法生成剧本
            </div>
          )}
          {drafts?.map((d) => {
            const eps = (d.outline as unknown as OutlineEp[]) ?? [];
            const isActive = selectedId === d.id && mode === 'detail';
            return (
              <div
                key={d.id}
                className={`group/d relative mb-1 rounded-md border transition-colors ${
                  d.pinned
                    ? 'border-amber-500/60 bg-amber-500/10'
                    : isActive
                      ? 'border-blue-600 bg-blue-600/10'
                      : 'border-transparent hover:bg-[hsl(var(--color-muted))]'
                }`}
              >
                <button
                  onClick={() => openDraft(d.id)}
                  className="block w-full px-2.5 py-2 pr-7 text-left"
                >
                  <div className="flex items-center gap-1">
                    {d.pinned && <Pin className="size-3 shrink-0 fill-amber-500 text-amber-500" />}
                    <span className="truncate text-xs font-medium">{d.title}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                    {d.pinned && (
                      <span className="rounded bg-amber-500/20 px-1 text-amber-700 dark:text-amber-300">
                        顶置
                      </span>
                    )}
                    <span className="rounded bg-[hsl(var(--color-secondary))] px-1">
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
                    <span>{eps.length} 集</span>
                  </div>
                </button>
                {/* 需求1d:顶置按钮(顶置后才能在剧本「关联剧本」选) */}
                <button
                  onClick={() => togglePin.mutate({ draftId: d.id })}
                  disabled={togglePin.isPending}
                  className={`absolute right-1 top-1.5 rounded p-0.5 transition-opacity ${
                    d.pinned
                      ? 'text-amber-500'
                      : 'text-[hsl(var(--color-muted-foreground))] opacity-0 group-hover/d:opacity-100 hover:text-amber-500'
                  }`}
                  title={d.pinned ? '取消顶置' : '顶置 — 顶置后才能在剧本「关联剧本」选用'}
                >
                  <Pin className={`size-3 ${d.pinned ? 'fill-current' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* 右:新建表单 或 草稿详情 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'new' || !selectedId ? (
          <NewInspirationForm
            projectId={projectId}
            onCreated={(id) => {
              void utils.inspiration.listDrafts.invalidate();
              openDraft(id);
            }}
          />
        ) : (
          <DraftDetail
            draftId={selectedId}
            onChanged={() => {
              void utils.inspiration.listDrafts.invalidate();
              void utils.inspiration.getDraft.invalidate({ draftId: selectedId });
            }}
            onDeleted={() => {
              void utils.inspiration.listDrafts.invalidate();
              openNew();
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 新建灵感表单
// ---------------------------------------------------------------------------

function NewInspirationForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (draftId: string) => void;
}): React.ReactElement {
  const [idea, setIdea] = React.useState('');
  const [genre, setGenre] = React.useState('');
  const [targetEpisodes, setTargetEpisodes] = React.useState('');
  const [lengthHint, setLengthHint] = React.useState('');
  const [tone, setTone] = React.useState('');

  const gen = trpc.inspiration.generateOutline.useMutation({
    onSuccess: (d) => {
      toast.success(`已生成《${d.title}》大纲`);
      onCreated(d.id);
    },
    onError: (e) => toast.error(`生成失败:${e.message}`),
  });

  const submit = (): void => {
    if (!idea.trim()) {
      toast.error('请输入想法/灵感');
      return;
    }
    gen.mutate({
      projectId,
      idea: idea.trim(),
      params: {
        genre: genre.trim() || undefined,
        targetEpisodes: targetEpisodes ? Number(targetEpisodes) : undefined,
        lengthHint: lengthHint.trim() || undefined,
        tone: tone.trim() || undefined,
      },
    });
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center gap-2">
        <Lightbulb className="size-5 text-amber-500" />
        <h2 className="text-lg font-semibold">灵感创作</h2>
      </div>
      <p className="mb-4 text-xs text-[hsl(var(--color-muted-foreground))]">
        输入一个想法/灵感,AI 先生成分集大纲,再逐集展开成完整剧本。生成的剧本可下载、在线保存,或经"剧本"页"关联剧本"转为某集正式剧本。
      </p>

      <label className="mb-1 block text-xs font-medium">想法 / 灵感 *</label>
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        rows={6}
        placeholder="例:一个普通上班族意外获得能听见他人内心声音的能力,卷入公司高层的权力斗争…"
        className="mb-3 w-full resize-y rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm"
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">题材类型(可选)</label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="都市 / 悬疑 / 甜宠 / 古装…"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">目标集数(可选)</label>
          <input
            type="number"
            min={1}
            max={100}
            value={targetEpisodes}
            onChange={(e) => setTargetEpisodes(e.target.value)}
            placeholder="如 12"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">篇幅基调(可选)</label>
          <input
            value={lengthHint}
            onChange={(e) => setLengthHint(e.target.value)}
            placeholder="每集 2-3 分钟竖屏短剧"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">整体基调(可选)</label>
          <input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="爽文 / 虐心 / 轻松搞笑…"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      <button
        onClick={submit}
        disabled={gen.isPending || !idea.trim()}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {gen.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {gen.isPending ? '生成大纲中…' : '生成分集大纲'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 草稿详情:大纲 + 逐集展开 + 编辑 + 下载
// ---------------------------------------------------------------------------

function DraftDetail({
  draftId,
  onChanged,
  onDeleted,
}: {
  draftId: string;
  onChanged: () => void;
  onDeleted: () => void;
}): React.ReactElement {
  const { data: draft, isLoading } = trpc.inspiration.getDraft.useQuery({ draftId });
  const [activeEp, setActiveEp] = React.useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const genEp = trpc.inspiration.generateEpisode.useMutation({
    onSuccess: () => onChanged(),
    onError: (e) => toast.error(`展开失败:${e.message}`),
  });
  const del = trpc.inspiration.deleteDraft.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      onDeleted();
    },
    onError: (e) => toast.error(`删除失败:${e.message}`),
  });

  if (isLoading || !draft) {
    return (
      <div className="p-6 text-sm text-[hsl(var(--color-muted-foreground))]">加载草稿中…</div>
    );
  }

  const outline = (draft.outline as unknown as OutlineEp[]) ?? [];
  const episodes = (draft.episodes as unknown as DraftEp[]) ?? [];
  const epByNum = new Map(episodes.map((e) => [e.number, e]));
  const activeContent = activeEp != null ? epByNum.get(activeEp)?.content : undefined;
  const generatedCount = episodes.filter((e) => e.content).length;

  const downloadAll = (): void => {
    const parts = [`《${draft.title}》\n想法:${draft.idea}\n`];
    for (const o of outline) {
      const ep = epByNum.get(o.number);
      parts.push(`\n========== 第${o.number}集:${o.title} ==========\n`);
      parts.push(ep?.content || `(本集尚未展开)\n梗概:${o.synopsis}`);
    }
    downloadText(`${draft.title}.txt`, parts.join('\n'));
  };

  const generateAll = async (): Promise<void> => {
    for (const o of outline) {
      if (!epByNum.get(o.number)?.content) {
        await genEp.mutateAsync({ draftId, episodeNumber: o.number });
      }
    }
    toast.success('已展开全部集');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{draft.title}</h2>
            <span className="shrink-0 rounded bg-[hsl(var(--color-secondary))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
              {STATUS_LABEL[draft.status] ?? draft.status} · {generatedCount}/{outline.length} 集已展开
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--color-muted-foreground))]" title={draft.idea}>
            想法:{draft.idea}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void generateAll()}
            disabled={genEp.isPending || generatedCount === outline.length}
            className="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--color-border))] px-2.5 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
          >
            {genEp.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            全部展开
          </button>
          <button
            onClick={downloadAll}
            className="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--color-border))] px-2.5 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
          >
            <Download className="size-3.5" />
            下载全剧
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            <Trash2 className="size-3.5" />
            删除
          </button>
        </div>
      </div>

      {/* 主体:大纲列表 + 选中集内容 */}
      <div className="flex min-h-0 flex-1">
        {/* 大纲各集 */}
        <div className="w-72 shrink-0 overflow-auto border-r border-[hsl(var(--color-border))] p-2">
          {outline.map((o) => {
            const ep = epByNum.get(o.number);
            const done = !!ep?.content;
            return (
              <div
                key={o.number}
                className={`mb-1.5 rounded-md border px-2.5 py-2 ${
                  activeEp === o.number
                    ? 'border-blue-600 bg-blue-600/10'
                    : 'border-[hsl(var(--color-border))]'
                }`}
              >
                <button onClick={() => setActiveEp(o.number)} className="block w-full text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      第{o.number}集 · {o.title}
                    </span>
                    {done ? (
                      <span className="shrink-0 rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-700 dark:text-emerald-300">
                        已展开
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-[hsl(var(--color-secondary))] px-1 text-[9px] text-[hsl(var(--color-muted-foreground))]">
                        未展开
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                    {o.synopsis}
                  </p>
                </button>
                <button
                  onClick={() => genEp.mutate({ draftId, episodeNumber: o.number })}
                  disabled={genEp.isPending}
                  className="mt-1.5 inline-flex items-center gap-1 rounded border border-[hsl(var(--color-border))] px-1.5 py-0.5 text-[10px] hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
                >
                  {genEp.isPending ? <Loader2 className="size-2.5 animate-spin" /> : <Sparkles className="size-2.5" />}
                  {done ? '重新展开' : '展开本集'}
                </button>
              </div>
            );
          })}
        </div>

        {/* 选中集剧本内容 */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {activeEp == null ? (
            <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--color-muted-foreground))]">
              ← 选择左侧某集查看 / 展开剧本
            </div>
          ) : activeContent ? (
            <EpisodeContent
              draftId={draftId}
              title={draft.title}
              episodeNumber={activeEp}
              episodes={episodes}
              content={activeContent}
              onSaved={onChanged}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[hsl(var(--color-muted-foreground))]">
              <p>第{activeEp}集尚未展开</p>
              <button
                onClick={() => genEp.mutate({ draftId, episodeNumber: activeEp })}
                disabled={genEp.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {genEp.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                展开本集剧本
              </button>
            </div>
          )}
        </div>
      </div>

      {deleteOpen && (
        <ConfirmDialog
          title={`删除灵感草稿《${draft.title}》?`}
          description="软删除该草稿(含大纲与各集内容)。已关联到剧本的不受影响。"
          confirmLabel="确认删除"
          danger
          onConfirm={() => del.mutate({ draftId })}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}

// 单集内容:可在线编辑保存 + 单集下载
function EpisodeContent({
  draftId,
  title,
  episodeNumber,
  episodes,
  content,
  onSaved,
}: {
  draftId: string;
  title: string;
  episodeNumber: number;
  episodes: DraftEp[];
  content: string;
  onSaved: () => void;
}): React.ReactElement {
  const [text, setText] = React.useState(content);
  React.useEffect(() => setText(content), [content, episodeNumber]);

  const save = trpc.inspiration.updateDraft.useMutation({
    onSuccess: () => {
      toast.success('已在线保存');
      onSaved();
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });

  const dirty = text !== content;

  const handleSave = (): void => {
    const next = episodes.map((e) =>
      e.number === episodeNumber ? { ...e, content: text } : e,
    );
    save.mutate({ draftId, episodes: next });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[hsl(var(--color-muted-foreground))]">
          第{episodeNumber}集剧本{dirty && ' · 未保存'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadText(`${title}-第${episodeNumber}集.txt`, text)}
            className="inline-flex items-center gap-1 rounded border border-[hsl(var(--color-border))] px-2 py-1 text-[11px] hover:bg-[hsl(var(--color-muted))]"
          >
            <FileDown className="size-3" />
            下载本集
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="size-3 animate-spin" />}
            在线保存
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-0 flex-1 resize-none rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-3 font-mono text-[13px] leading-relaxed"
      />
    </div>
  );
}
