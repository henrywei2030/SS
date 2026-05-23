'use client';
import * as React from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const CATEGORY_LABELS: Record<string, string> = {
  ASSET_BREAKDOWN: '资产拆解',
  IMAGE_GENERATION: '图像生成',
  SHOT_GENERATION: '镜头生图',
  SCRIPT_STORYBOARD: '剧本分镜',
  PANORAMA_360: '360 全景',
  PROMPT_FRAGMENT: '复用片段',
  PROMPT_PRESET: '预设组合',
};

export function PromptsManager(): React.ReactElement {
  const { data: templates, isLoading, isError, error, refetch } = trpc.admin.prompt.list.useQuery();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  React.useEffect(() => {
    if (!selectedId && templates && templates.length > 0) {
      setSelectedId(templates[0]!.id);
    }
  }, [templates, selectedId]);

  const grouped = React.useMemo(() => {
    type Item = NonNullable<typeof templates>[number];
    const m = new Map<string, Item[]>();
    if (!templates) return m;
    for (const t of templates) {
      const arr = m.get(t.category) ?? [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return m;
  }, [templates]);

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Prompt 模板</h1>
        <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
          编辑业务侧 LLM 提示词模板 · 支持版本历史 + 一键回滚
        </p>
      </header>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">模板列表加载失败</div>
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
        {/* 左:分类 + 列表 */}
        <aside className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
          {isLoading ? (
            <div className="p-3 text-xs text-[hsl(var(--color-muted-foreground))]">加载中...</div>
          ) : (
            <div className="space-y-2 p-2">
              {Array.from(grouped.entries()).map(([cat, list]) => (
                <div key={cat}>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </div>
                  {list.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${
                        selectedId === t.id
                          ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                          : 'hover:bg-[hsl(var(--color-muted))]'
                      }`}
                    >
                      <span className="truncate">
                        <span className="font-medium">{t.name}</span>
                        <span className="ml-1 opacity-60">{t.slug}</span>
                      </span>
                      {t._count.versions > 0 && (
                        <span className="ml-2 shrink-0 rounded bg-blue-500/20 px-1 text-[9px] text-blue-600 dark:text-blue-400">
                          {t._count.versions}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* 右:编辑器 */}
        <main>
          {selectedId ? (
            <PromptEditor
              templateId={selectedId}
              onSaved={() => refetch()}
              onOpenHistory={() => setHistoryOpen(true)}
              historyOpen={historyOpen}
              onCloseHistory={() => setHistoryOpen(false)}
            />
          ) : (
            <div className="rounded-md border border-dashed border-[hsl(var(--color-border))] p-12 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
              {isLoading ? '加载中...' : '选一个模板开始编辑'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

interface EditorProps {
  templateId: string;
  onSaved: () => void;
  onOpenHistory: () => void;
  historyOpen: boolean;
  onCloseHistory: () => void;
}

function PromptEditor({
  templateId,
  onSaved,
  onOpenHistory,
  historyOpen,
  onCloseHistory,
}: EditorProps): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: t, isLoading } = trpc.admin.prompt.getById.useQuery({ id: templateId });
  const [content, setContent] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [changeLog, setChangeLog] = React.useState('');

  // W7 audit R2:只在 templateId 切换 或 当前无 dirty 时同步,避免 invalidate 覆盖用户草稿
  const lastSyncedTemplateId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!t) return;
    const isInitialSync = lastSyncedTemplateId.current !== templateId;
    const dirty = content !== t.content || description !== (t.description ?? '');
    if (isInitialSync || !dirty) {
      setContent(t.content);
      setDescription(t.description ?? '');
      setChangeLog('');
      lastSyncedTemplateId.current = templateId;
    }
    // dirty 时不覆盖,等用户保存(mutation onSuccess 会触发 invalidate,
    // 但此时本地 content === t.content 因为已经被覆盖,dirty=false,正常同步)
  }, [t, templateId, content, description]);

  const update = trpc.admin.prompt.update.useMutation({
    onSuccess: () => {
      toast.success('模板已保存,旧版本进历史');
      onSaved();
      void utils.admin.prompt.getById.invalidate({ id: templateId });
      void utils.admin.prompt.listVersions.invalidate({ templateId });
      setChangeLog('');
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });

  if (isLoading || !t) {
    return (
      <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-6 text-sm text-[hsl(var(--color-muted-foreground))]">
        加载中...
      </div>
    );
  }

  const dirty = content !== t.content || description !== (t.description ?? '');

  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
      <header className="border-b border-[hsl(var(--color-border))] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{t.name}</h2>
            <div className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
              {CATEGORY_LABELS[t.category] ?? t.category} · slug: <span className="font-mono">{t.slug}</span> · v {t.versionTag}
              {t.modelHint && ` · 推荐模型 ${t.modelHint}`}
            </div>
          </div>
          <button
            onClick={onOpenHistory}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))]"
          >
            历史版本({t._count.versions})
          </button>
        </div>
      </header>

      <div className="space-y-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium">描述</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="给这个模板的简短说明(可选)"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">
            模板正文(支持 {'{{var}}'} 占位符)
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-96 w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] p-3 text-xs leading-relaxed font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">本次改动备注(进历史 changeLog)</label>
          <input
            value={changeLog}
            onChange={(e) => setChangeLog(e.target.value)}
            placeholder="例:加强对反派人物描述的指令"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-xs"
          />
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-[hsl(var(--color-border))] px-4 py-3">
        <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
          {dirty ? '有未保存改动' : '未修改'}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setContent(t.content);
              setDescription(t.description ?? '');
              setChangeLog('');
            }}
            disabled={!dirty || update.isPending}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
          >
            撤销
          </button>
          <button
            onClick={() =>
              update.mutate({
                id: templateId,
                content,
                description: description || undefined,
                changeLog: changeLog || undefined,
              })
            }
            disabled={!dirty || update.isPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {update.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      </footer>

      {historyOpen && (
        <HistoryDialog
          templateId={templateId}
          onClose={onCloseHistory}
          onRestored={() => {
            onSaved();
            void utils.admin.prompt.getById.invalidate({ id: templateId });
          }}
        />
      )}
    </div>
  );
}

function HistoryDialog({
  templateId,
  onClose,
  onRestored,
}: {
  templateId: string;
  onClose: () => void;
  onRestored: () => void;
}): React.ReactElement {
  const { data: versions, isLoading } = trpc.admin.prompt.listVersions.useQuery({ templateId });
  const [selectedVerId, setSelectedVerId] = React.useState<string | null>(null);
  const [restoreConfirm, setRestoreConfirm] = React.useState<{ id: string; tag: string } | null>(null);
  const utils = trpc.useUtils();

  const restore = trpc.admin.prompt.restoreVersion.useMutation({
    onSuccess: () => {
      toast.success('已回滚到该版本(当前 content 自动归档为新版本)');
      void utils.admin.prompt.listVersions.invalidate({ templateId });
      onRestored();
      onClose();
    },
    onError: (e) => toast.error(`回滚失败:${e.message}`),
  });

  const sel = versions?.find((v) => v.id === selectedVerId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-[hsl(var(--color-card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-5 py-3">
          <h3 className="text-sm font-semibold">历史版本</h3>
          <button onClick={onClose} className="text-sm hover:opacity-70">
            ✕
          </button>
        </header>
        <div className="grid flex-1 grid-cols-[260px_1fr] overflow-hidden">
          <aside className="overflow-y-auto border-r border-[hsl(var(--color-border))]">
            {isLoading ? (
              <div className="p-3 text-xs text-[hsl(var(--color-muted-foreground))]">加载中...</div>
            ) : !versions || versions.length === 0 ? (
              <div className="p-6 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
                还没有历史版本
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVerId(v.id)}
                    className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                      selectedVerId === v.id
                        ? 'bg-[hsl(var(--color-accent))] text-[hsl(var(--color-accent-foreground))]'
                        : 'hover:bg-[hsl(var(--color-muted))]'
                    }`}
                  >
                    <div className="font-mono text-[11px]">{v.versionTag}</div>
                    <div className="mt-0.5 text-[10px] opacity-70">
                      {new Date(v.createdAt).toLocaleString('zh-CN')}
                    </div>
                    {v.changeLog && (
                      <div className="mt-0.5 truncate text-[10px] opacity-60">{v.changeLog}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </aside>
          <main className="flex flex-col overflow-hidden">
            {sel ? (
              <>
                <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] p-3">
                  <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
                    {sel.versionTag} · {new Date(sel.createdAt).toLocaleString('zh-CN')}
                  </div>
                  <button
                    onClick={() => setRestoreConfirm({ id: sel.id, tag: sel.versionTag })}
                    disabled={restore.isPending}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {restore.isPending ? '回滚中...' : '回滚到此版本'}
                  </button>
                </div>
                <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs font-mono leading-relaxed">
                  {sel.content}
                </pre>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-[hsl(var(--color-muted-foreground))]">
                选一个版本查看
              </div>
            )}
          </main>
        </div>
      </div>

      {restoreConfirm && (
        <ConfirmDialog
          title={`回滚到 ${restoreConfirm.tag}?`}
          description="当前 content 会先自动归档为新版本,然后用该历史版本替换"
          confirmLabel="回滚"
          onClose={() => setRestoreConfirm(null)}
          onConfirm={() => {
            restore.mutate({ templateId, versionId: restoreConfirm.id });
            setRestoreConfirm(null);
          }}
        />
      )}
    </div>
  );
}
