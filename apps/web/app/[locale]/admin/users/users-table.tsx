'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { Search, Shield, ShieldOff, UserCheck, UserX, Clock } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING';

interface ConfirmAction {
  kind: 'setStatus' | 'setAdmin';
  userId: string;
  userName: string;
  newValue: UserStatus | boolean;
  current: UserStatus | boolean;
}

const STATUS_LABELS: Record<UserStatus, { label: string; tone: string }> = {
  ACTIVE: { label: '活跃', tone: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  SUSPENDED: { label: '已禁用', tone: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  PENDING: { label: '待激活', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
          {hint}
        </div>
      )}
    </div>
  );
}

export function UsersTable(): React.ReactElement {
  const utils = trpc.useUtils();
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(50);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<UserStatus | ''>('');
  const [confirm, setConfirm] = React.useState<ConfirmAction | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } =
    trpc.admin.user.list.useQuery({
      page,
      pageSize,
      search: search.trim() || undefined,
      status: statusFilter || undefined,
    });

  const { data: stats } = trpc.admin.user.stats.useQuery();

  React.useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const setStatus = trpc.admin.user.setStatus.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.displayName} 状态已更新`);
      void utils.admin.user.list.invalidate();
      void utils.admin.user.stats.invalidate();
      setConfirm(null);
    },
    onError: (e) => toast.error(`更新失败:${e.message}`),
  });

  const setAdmin = trpc.admin.user.setAdmin.useMutation({
    onSuccess: (d) => {
      toast.success(
        `${d.displayName} ${d.isAdmin ? '已设为管理员' : '已取消管理员'}`,
      );
      void utils.admin.user.list.invalidate();
      void utils.admin.user.stats.invalidate();
      setConfirm(null);
    },
    onError: (e) => toast.error(`更新失败:${e.message}`),
  });

  const doConfirm = (): void => {
    if (!confirm) return;
    if (confirm.kind === 'setStatus') {
      setStatus.mutate({ userId: confirm.userId, status: confirm.newValue as UserStatus });
    } else {
      setAdmin.mutate({ userId: confirm.userId, isAdmin: confirm.newValue as boolean });
    }
  };

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">用户管理</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            全局用户列表 — 启用/禁用 · 设/取消管理员 · 搜索
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="rounded-md border border-[hsl(var(--color-border))] px-3 py-1.5 text-xs hover:bg-[hsl(var(--color-muted))] disabled:opacity-50"
        >
          {isFetching ? '刷新中...' : '刷新'}
        </button>
      </header>

      {/* KPI 4 卡 */}
      {stats && (
        <div className="mb-4 grid grid-cols-4 gap-3">
          <StatCard label="总用户" value={stats.total} hint={`管理员 ${stats.admins} 人`} />
          <StatCard label="活跃" value={stats.active} />
          <StatCard label="已禁用" value={stats.suspended} />
          <StatCard label="待激活" value={stats.pending} />
        </div>
      )}

      {/* 筛选栏 */}
      <div className="mb-4 flex items-center gap-2 text-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--color-muted-foreground))]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 email / username / displayName"
            className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] py-1.5 pl-7 pr-2 text-xs"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as UserStatus | '')}
          className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 py-1.5 text-xs"
        >
          <option value="">全部状态</option>
          <option value="ACTIVE">活跃</option>
          <option value="SUSPENDED">已禁用</option>
          <option value="PENDING">待激活</option>
        </select>
      </div>

      {isError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <div className="font-semibold">用户列表加载失败</div>
          <div className="mt-1 opacity-80">{error?.message}</div>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
      )}

      {data && (
        <>
          <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--color-muted))]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">用户</th>
                  <th className="w-24 px-3 py-2 text-left font-medium">角色</th>
                  <th className="w-24 px-3 py-2 text-left font-medium">状态</th>
                  <th className="w-32 px-3 py-2 text-right font-medium">项目</th>
                  <th className="w-40 px-3 py-2 text-left font-medium">上次登录</th>
                  <th className="w-44 px-3 py-2 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => {
                  const statusInfo = STATUS_LABELS[u.status];
                  return (
                    <tr
                      key={u.id}
                      className="border-t border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))]/30"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.displayName}</div>
                        <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                          @{u.username} · {u.email}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {u.isAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                            <Shield className="size-2.5" />
                            管理员
                          </span>
                        ) : (
                          <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                            普通用户
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-medium ${statusInfo.tone}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-[hsl(var(--color-muted-foreground))]">
                        owner {u._count.ownedProjects} · member{' '}
                        {u._count.memberships}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        {u.lastLoginAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-2.5" />
                            {new Date(u.lastLoginAt).toLocaleString()}
                          </span>
                        ) : (
                          '从未登录'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {/* 启用/禁用 */}
                          {u.status === 'ACTIVE' ? (
                            <button
                              onClick={() =>
                                setConfirm({
                                  kind: 'setStatus',
                                  userId: u.id,
                                  userName: u.displayName,
                                  newValue: 'SUSPENDED',
                                  current: u.status,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-[hsl(var(--color-border))] px-2 py-0.5 text-[10px] hover:bg-red-500/10 hover:text-red-600"
                              title="禁用账号"
                            >
                              <UserX className="size-2.5" />
                              禁用
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                setConfirm({
                                  kind: 'setStatus',
                                  userId: u.id,
                                  userName: u.displayName,
                                  newValue: 'ACTIVE',
                                  current: u.status,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-[hsl(var(--color-border))] px-2 py-0.5 text-[10px] hover:bg-green-500/10 hover:text-green-600"
                              title="启用账号"
                            >
                              <UserCheck className="size-2.5" />
                              启用
                            </button>
                          )}
                          {/* 设/取消管理员 */}
                          {u.isAdmin ? (
                            <button
                              onClick={() =>
                                setConfirm({
                                  kind: 'setAdmin',
                                  userId: u.id,
                                  userName: u.displayName,
                                  newValue: false,
                                  current: true,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-[hsl(var(--color-border))] px-2 py-0.5 text-[10px] hover:bg-orange-500/10 hover:text-orange-600"
                              title="取消管理员"
                            >
                              <ShieldOff className="size-2.5" />
                              取消管理员
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                setConfirm({
                                  kind: 'setAdmin',
                                  userId: u.id,
                                  userName: u.displayName,
                                  newValue: true,
                                  current: false,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-[hsl(var(--color-border))] px-2 py-0.5 text-[10px] hover:bg-blue-500/10 hover:text-blue-600"
                              title="设为管理员"
                            >
                              <Shield className="size-2.5" />
                              设管理员
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {data.users.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-[hsl(var(--color-muted-foreground))]"
                    >
                      没有匹配的用户
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <div className="text-[hsl(var(--color-muted-foreground))]">
              共 {data.total} 条 · 第 {page} 页 / {Math.ceil(data.total / pageSize) || 1} 页
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="rounded border border-[hsl(var(--color-border))] px-3 py-1 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data.hasMore}
                className="rounded border border-[hsl(var(--color-border))] px-3 py-1 hover:bg-[hsl(var(--color-muted))] disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}

      {/* 确认对话框 */}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'setStatus'
              ? `${confirm.newValue === 'SUSPENDED' ? '禁用' : '启用'} ${confirm.userName}?`
              : `${confirm.newValue ? '设为管理员' : '取消管理员'} ${confirm.userName}?`
          }
          description={
            confirm.kind === 'setStatus' && confirm.newValue === 'SUSPENDED'
              ? '该用户将无法登录,已登录会话不立即失效(JWT 自然过期)。可随时启用。'
              : confirm.kind === 'setAdmin' && confirm.newValue === true
                ? '该用户将获得完整后台管理权限(查看所有项目 / 改系统设置 / 操作日志)。'
                : confirm.kind === 'setAdmin' && confirm.newValue === false
                  ? '该用户将失去后台权限。系统至少要保留一个活跃管理员。'
                  : '该用户将能重新登录。'
          }
          confirmLabel="确认"
          danger={confirm.kind === 'setStatus' && confirm.newValue === 'SUSPENDED'}
          onConfirm={doConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
