'use client';
import * as React from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type PresetKind = 'framing' | 'angle' | 'movement' | 'lighting';

const KIND_DESCRIPTIONS: Record<PresetKind, string> = {
  framing: '镜头取景范围:从大全景到大特写',
  angle: '相机角度:平视 / 俯角 / 仰角 / 过肩 ...',
  movement: '运镜方式:固定 / 推 / 拉 / 摇 / 移 ...',
  lighting: '光线条件:自然光 / 硬光 / 柔光 / 逆光 ...',
};

export function PresetsManager(): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: presets, isLoading, isError, error, refetch } = trpc.admin.preset.list.useQuery();
  const [activeKind, setActiveKind] = React.useState<PresetKind>('framing');
  const [resetConfirm, setResetConfirm] = React.useState<{ kind: PresetKind; label: string } | null>(null);

  const set = trpc.admin.preset.set.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.kind} 预设已保存(${data.values.length} 项)`);
      void utils.admin.preset.list.invalidate();
    },
    onError: (e) => toast.error(`保存失败:${e.message}`),
  });

  const reset = trpc.admin.preset.resetToDefault.useMutation({
    onSuccess: () => {
      toast.success('已恢复默认');
      void utils.admin.preset.list.invalidate();
    },
    onError: (e) => toast.error(`恢复失败:${e.message}`),
  });

  const active = presets?.find((p) => p.kind === activeKind);

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">预设模板</h1>
        <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
          分镜编辑 / AIGC 抽卡时下拉选项 — 4 类预设:景别 / 机位 / 运镜 / 光线
        </p>
      </header>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">预设加载失败</div>
          <div className="mt-1 opacity-80">{error?.message}</div>
          <button
            onClick={() => refetch()}
            className="mt-2 rounded border border-red-500/50 px-2 py-1 text-xs hover:bg-red-500/20"
          >
            重试
          </button>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="mb-4 flex gap-2 border-b border-[hsl(var(--color-border))]">
        {(['framing', 'angle', 'movement', 'lighting'] as const).map((k) => {
          const p = presets?.find((x) => x.kind === k);
          return (
            <button
              key={k}
              onClick={() => setActiveKind(k)}
              className={`relative -mb-px border-b-2 px-3 py-2 text-sm ${
                activeKind === k
                  ? 'border-blue-500 text-[hsl(var(--color-foreground))]'
                  : 'border-transparent text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]'
              }`}
            >
              {p?.label ?? k}
              {p && <span className="ml-1 text-[10px] opacity-60">({p.values.length})</span>}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
      ) : active ? (
        <PresetEditor
          kind={active.kind as PresetKind}
          label={active.label}
          description={KIND_DESCRIPTIONS[active.kind as PresetKind]}
          initialValues={active.values}
          isDefault={active.isDefault}
          onSave={(values) => set.mutate({ kind: active.kind as PresetKind, values })}
          savePending={set.isPending}
          onReset={() =>
            setResetConfirm({ kind: active.kind as PresetKind, label: active.label })
          }
          resetPending={reset.isPending}
        />
      ) : null}

      {resetConfirm && (
        <ConfirmDialog
          title={`恢复 "${resetConfirm.label}" 为默认?`}
          description="当前自定义列表会丢失,改回 router 内置默认值"
          confirmLabel="恢复默认"
          danger
          onClose={() => setResetConfirm(null)}
          onConfirm={() => {
            reset.mutate({ kind: resetConfirm.kind });
            setResetConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function PresetEditor({
  kind,
  label,
  description,
  initialValues,
  isDefault,
  onSave,
  savePending,
  onReset,
  resetPending,
}: {
  kind: PresetKind;
  label: string;
  description: string;
  initialValues: string[];
  isDefault: boolean;
  onSave: (values: string[]) => void;
  savePending: boolean;
  onReset: () => void;
  resetPending: boolean;
}): React.ReactElement {
  const [values, setValues] = React.useState(initialValues);
  const [newItem, setNewItem] = React.useState('');

  // W7 audit R2:只在 kind 切换时 reset,initialValues 变化不强制 reset
  // 防 invalidate 触发 useEffect 把用户草稿覆盖
  const lastSyncedKind = React.useRef<PresetKind | null>(null);
  React.useEffect(() => {
    if (lastSyncedKind.current !== kind) {
      setValues(initialValues);
      setNewItem('');
      lastSyncedKind.current = kind;
    }
  }, [kind, initialValues]);

  const dirty =
    values.length !== initialValues.length ||
    values.some((v, i) => v !== initialValues[i]);

  const add = (): void => {
    const v = newItem.trim();
    if (!v) return;
    if (values.includes(v)) {
      toast.error(`"${v}" 已存在`);
      return;
    }
    setValues([...values, v]);
    setNewItem('');
  };

  const remove = (i: number): void => {
    setValues(values.filter((_, idx) => idx !== i));
  };

  const move = (i: number, dir: -1 | 1): void => {
    const next = i + dir;
    if (next < 0 || next >= values.length) return;
    const arr = [...values];
    [arr[i], arr[next]] = [arr[next]!, arr[i]!];
    setValues(arr);
  };

  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]">
      <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">
            {label}
            {isDefault && (
              <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                默认值
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">{description}</p>
        </div>
        {!isDefault && (
          <button
            onClick={onReset}
            disabled={resetPending}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
          >
            {resetPending ? '恢复中...' : '恢复默认'}
          </button>
        )}
      </header>

      <div className="space-y-2 p-4">
        {values.length === 0 ? (
          <div className="rounded-md border border-dashed border-[hsl(var(--color-border))] p-6 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
            还没有项 — 在下方添加
          </div>
        ) : (
          values.map((v, i) => (
            <div
              key={`${i}-${v}`}
              className="flex items-center gap-2 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-1.5"
            >
              <span className="w-8 shrink-0 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="flex-1 text-sm">{v}</span>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`上移 ${v}`}
                className="rounded px-1 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === values.length - 1}
                aria-label={`下移 ${v}`}
                className="rounded px-1 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                ↓
              </button>
              <button
                onClick={() => remove(i)}
                aria-label={`删除 ${v}`}
                className="rounded px-1 text-xs text-red-500 hover:bg-red-500/10"
              >
                ×
              </button>
            </div>
          ))
        )}

        <div className="flex gap-2 pt-2">
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="新增项(回车添加)"
            maxLength={50}
            className="flex-1 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-1.5 text-sm"
          />
          <button
            onClick={add}
            disabled={!newItem.trim() || values.length >= 50}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
          >
            添加
          </button>
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-[hsl(var(--color-border))] px-4 py-3">
        <div className="text-xs text-[hsl(var(--color-muted-foreground))]">
          {dirty ? '有未保存改动' : `${values.length} 项 · 未修改`}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setValues(initialValues)}
            disabled={!dirty || savePending}
            className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
          >
            撤销
          </button>
          <button
            onClick={() => onSave(values)}
            disabled={!dirty || values.length === 0 || savePending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savePending ? '保存中...' : '保存'}
          </button>
        </div>
      </footer>
    </div>
  );
}
