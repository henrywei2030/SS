'use client';
import * as React from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const KIND_LABELS: Record<string, string> = {
  AI_REAL: 'AI 真人',
  ANIM_3D: '3D 国漫',
  ANIM_2D: '2D 动漫',
  CUSTOM: '自定义',
};

export function StylesManager(): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: styles, isLoading, isError, error, refetch } = trpc.admin.style.list.useQuery();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState<{ id: string; name: string } | null>(null);

  React.useEffect(() => {
    if (!selectedId && styles && styles.length > 0) {
      setSelectedId(styles[0]!.id);
    }
  }, [styles, selectedId]);

  // W1-W7 audit:invalidate 已经触发 refetch,不要再手动 refetch(原版双触发浪费一次 RTT)
  const update = trpc.admin.style.update.useMutation({
    onSuccess: () => {
      toast.success('已保存');
      void utils.admin.style.list.invalidate();
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });

  const del = trpc.admin.style.delete.useMutation({
    onSuccess: (data) => {
      toast.success('已删除');
      if (selectedId === data.id) setSelectedId(null);
      void utils.admin.style.list.invalidate();
    },
    onError: (e) => toast.error(`删除失败:${e.message}`),
  });

  const create = trpc.admin.style.create.useMutation({
    onSuccess: (data) => {
      toast.success(`已新建:${data.name}`);
      setCreateOpen(false);
      setSelectedId(data.id);
      void utils.admin.style.list.invalidate();
    },
    onError: (e) => toast.error(`新建失败:${e.message}`),
  });

  const sel = styles?.find((s) => s.id === selectedId) ?? null;

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">风格管理</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            风格 = 项目 / 资产生成的"美术 DNA":character/scene/prop 三段 prompt + 禁用词
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          + 新建自定义风格
        </button>
      </header>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">风格列表加载失败</div>
          <div className="mt-1 opacity-80">{error?.message}</div>
          <button
            onClick={() => refetch()}
            className="mt-2 rounded border border-red-500/50 px-2 py-1 text-xs hover:bg-red-500/20"
          >
            重试
          </button>
        </div>
      )}

      <div className="grid grid-cols-[280px_1fr] gap-4">
        <aside className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
          {isLoading ? (
            <div className="p-3 text-xs text-[hsl(var(--color-muted-foreground))]">加载中...</div>
          ) : (
            <div className="space-y-1 p-2">
              {(styles ?? []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs ${
                    selectedId === s.id
                      ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                      : 'hover:bg-[hsl(var(--color-muted))]'
                  }`}
                >
                  <span>
                    <span className="font-medium">{s.name}</span>
                    <div className="text-[10px] opacity-60">{s.slug}</div>
                  </span>
                  {s.isBuiltIn && (
                    <span className="ml-2 shrink-0 rounded bg-amber-500/20 px-1 text-[9px] text-amber-600 dark:text-amber-400">
                      内置
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>

        <main>
          {sel ? (
            <StyleEditor
              key={sel.id}
              style={sel}
              onUpdate={(patch) => update.mutate({ id: sel.id, ...patch })}
              updatePending={update.isPending}
              onDelete={() => setDeleteConfirm({ id: sel.id, name: sel.name })}
              deletePending={del.isPending}
            />
          ) : (
            <div className="rounded-md border border-dashed border-[hsl(var(--color-border))] p-12 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
              选一个风格开始编辑,或新建自定义风格
            </div>
          )}
        </main>
      </div>

      {createOpen && (
        <CreateDialog
          onClose={() => setCreateOpen(false)}
          onCreate={(input) => create.mutate(input)}
          pending={create.isPending}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title={`删除风格 "${deleteConfirm.name}"?`}
          description="如该风格被项目 / 资产引用,删除会被拒绝"
          confirmLabel="删除"
          danger
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => {
            del.mutate({ id: deleteConfirm.id });
            setDeleteConfirm(null);
          }}
        />
      )}
    </div>
  );
}

interface StyleData {
  id: string;
  name: string;
  slug: string;
  kind: string;
  characterPrompt: string;
  scenePrompt: string;
  propPrompt: string;
  forbiddenWords: string[];
  isBuiltIn: boolean;
}

function StyleEditor({
  style,
  onUpdate,
  updatePending,
  onDelete,
  deletePending,
}: {
  style: StyleData;
  onUpdate: (patch: {
    name?: string;
    characterPrompt?: string;
    scenePrompt?: string;
    propPrompt?: string;
    forbiddenWords?: string[];
  }) => void;
  updatePending: boolean;
  onDelete: () => void;
  deletePending: boolean;
}): React.ReactElement {
  const [name, setName] = React.useState(style.name);
  const [characterPrompt, setCharacterPrompt] = React.useState(style.characterPrompt);
  const [scenePrompt, setScenePrompt] = React.useState(style.scenePrompt);
  const [propPrompt, setPropPrompt] = React.useState(style.propPrompt);
  const [forbiddenWords, setForbiddenWords] = React.useState(style.forbiddenWords.join(', '));

  const dirty =
    name !== style.name ||
    characterPrompt !== style.characterPrompt ||
    scenePrompt !== style.scenePrompt ||
    propPrompt !== style.propPrompt ||
    forbiddenWords !==
      style.forbiddenWords.join(', ');

  const save = (): void => {
    onUpdate({
      ...(name !== style.name && { name }),
      characterPrompt,
      scenePrompt,
      propPrompt,
      forbiddenWords: forbiddenWords
        .split(/[,,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
      <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">{style.name}</h2>
          <div className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
            {KIND_LABELS[style.kind] ?? style.kind} · slug: <span className="font-mono">{style.slug}</span>
            {style.isBuiltIn && ' · 内置'}
          </div>
        </div>
        {!style.isBuiltIn && (
          <button
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {deletePending ? '删除中...' : '删除'}
          </button>
        )}
      </header>

      <div className="space-y-4 p-4">
        {!style.isBuiltIn && (
          <div>
            <label className="mb-1 block text-xs font-medium">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium">人物 prompt(characterPrompt)</label>
          <textarea
            value={characterPrompt}
            onChange={(e) => setCharacterPrompt(e.target.value)}
            className="h-28 w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-3 text-xs leading-relaxed font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">场景 prompt(scenePrompt)</label>
          <textarea
            value={scenePrompt}
            onChange={(e) => setScenePrompt(e.target.value)}
            className="h-28 w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-3 text-xs leading-relaxed font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">道具 prompt(propPrompt)</label>
          <textarea
            value={propPrompt}
            onChange={(e) => setPropPrompt(e.target.value)}
            className="h-28 w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-3 text-xs leading-relaxed font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">
            禁用词(逗号或换行分隔,最多 50 个)
          </label>
          <textarea
            value={forbiddenWords}
            onChange={(e) => setForbiddenWords(e.target.value)}
            placeholder="模糊, 低质量, 畸形, 错误文字"
            className="h-20 w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-3 text-xs leading-relaxed"
          />
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-[hsl(var(--color-border))] px-4 py-3">
        <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
          {dirty ? '有未保存改动' : '未修改'}
        </div>
        <button
          onClick={save}
          disabled={!dirty || updatePending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {updatePending ? '保存中...' : '保存'}
        </button>
      </footer>
    </div>
  );
}

function CreateDialog({
  onClose,
  onCreate,
  pending,
}: {
  onClose: () => void;
  onCreate: (input: { name: string; slug: string }) => void;
  pending: boolean;
}): React.ReactElement {
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-[hsl(var(--color-card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-[hsl(var(--color-border))] px-5 py-3">
          <h3 className="text-sm font-semibold">新建自定义风格</h3>
        </header>
        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium">名称</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="例:港式霓虹"
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              slug(小写字母 / 数字 / 下划线,2-50 字符)
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              maxLength={50}
              placeholder="hk_neon"
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-[hsl(var(--color-border))] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
          >
            取消
          </button>
          <button
            onClick={() => onCreate({ name: name.trim(), slug: slug.trim() })}
            disabled={!name.trim() || !slug.trim() || pending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? '创建中...' : '创建'}
          </button>
        </footer>
      </div>
    </div>
  );
}
