'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { Search, UserPlus, X, Crown, Shield, Star, User } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type MemberRole = 'ADMIN' | 'LEADER' | 'MEMBER' | 'VIEWER';
type AssignRole = 'OWNER' | 'COLLAB' | 'REVIEWER';

const ROLE_LABELS: Record<MemberRole, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  ADMIN: { label: '管理员', tone: 'bg-blue-500/15 text-blue-700 dark:text-blue-400', icon: Shield },
  LEADER: { label: '组长', tone: 'bg-purple-500/15 text-purple-700 dark:text-purple-400', icon: Star },
  MEMBER: { label: '成员', tone: 'bg-[hsl(var(--color-muted))] text-[hsl(var(--color-foreground))]', icon: User },
  VIEWER: { label: '观察者', tone: 'bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]', icon: User },
};

const ASSIGN_ROLE_LABELS: Record<AssignRole, { label: string; tone: string }> = {
  OWNER: { label: '主负责', tone: 'bg-purple-500/15 text-purple-700 dark:text-purple-400' },
  COLLAB: { label: '协作', tone: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  REVIEWER: { label: '审核', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

function Avatar({ name, url, size = 'sm' }: { name: string; url?: string | null; size?: 'sm' | 'md' }): React.ReactElement {
  const px = size === 'md' ? 'size-8 text-[11px]' : 'size-6 text-[10px]';
  const initial = name.charAt(0).toUpperCase();
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name} className={`${px} rounded-full object-cover`} />
    );
  }
  return (
    <div className={`${px} flex items-center justify-center rounded-full bg-[hsl(var(--color-muted))] font-medium text-[hsl(var(--color-foreground))]`}>
      {initial}
    </div>
  );
}

export function TeamManager({ projectId }: { projectId: string }): React.ReactElement {
  const utils = trpc.useUtils();
  const { data: members, isLoading: membersLoading } =
    trpc.project.listMembers.useQuery({ projectId });
  const { data: assignments, isLoading: assignmentsLoading } =
    trpc.project.listAssignments.useQuery({ projectId });

  const [addOpen, setAddOpen] = React.useState(false);
  const [assignFor, setAssignFor] = React.useState<{ episodeId: string; episodeLabel: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = React.useState<{ userId: string; userName: string } | null>(null);

  const removeMember = trpc.project.removeMember.useMutation({
    onSuccess: () => {
      toast.success('成员已移除');
      void utils.project.listMembers.invalidate({ projectId });
      void utils.project.listAssignments.invalidate({ projectId });
      setRemoveConfirm(null);
    },
    onError: (e) => toast.error(`移除失败:${e.message}`),
  });

  const updateRole = trpc.project.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success('角色已更新');
      void utils.project.listMembers.invalidate({ projectId });
    },
    onError: (e) => toast.error(`更新失败:${e.message}`),
  });

  const unassign = trpc.project.unassignUser.useMutation({
    onSuccess: () => {
      toast.success('已取消分配');
      void utils.project.listAssignments.invalidate({ projectId });
    },
    onError: (e) => toast.error(`取消失败:${e.message}`),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between border-b border-[hsl(var(--color-border))] pb-3">
        <div>
          <h1 className="text-2xl font-semibold">团队管理</h1>
          <p className="mt-1 text-sm text-[hsl(var(--color-muted-foreground))]">
            项目成员 · 集数分配 · 角色权限
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <UserPlus className="size-3" />
          添加成员
        </button>
      </header>

      {/* 成员列表 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          项目成员
          {members && (
            <span className="ml-2 text-xs font-normal text-[hsl(var(--color-muted-foreground))]">
              共 {members.members.length + 1} 人(含 owner)
            </span>
          )}
        </h2>
        {membersLoading && (
          <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
        )}
        {members && (
          <div className="overflow-hidden rounded-md border border-[hsl(var(--color-border))]">
            <table className="w-full text-xs">
              <thead className="bg-[hsl(var(--color-muted))]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">成员</th>
                  <th className="w-32 px-3 py-2 text-left font-medium">角色</th>
                  <th className="px-3 py-2 text-left font-medium">可访问模块</th>
                  <th className="w-32 px-3 py-2 text-left font-medium">加入时间</th>
                  <th className="w-20 px-3 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {/* Owner 行 */}
                {members.owner && (
                  <tr className="border-t border-[hsl(var(--color-border))] bg-purple-500/5">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={members.owner.displayName} url={members.owner.avatarUrl} />
                        <div>
                          <div className="font-medium">{members.owner.displayName}</div>
                          <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">{members.owner.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 rounded bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-400">
                        <Crown className="size-2.5" />
                        Owner
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[hsl(var(--color-muted-foreground))]">全部模块</td>
                    <td className="px-3 py-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">—</td>
                    <td />
                  </tr>
                )}
                {/* Members */}
                {members.members.map((m) => {
                  const roleInfo = ROLE_LABELS[m.role as MemberRole];
                  const RoleIcon = roleInfo.icon;
                  return (
                    <tr key={m.userId} className="border-t border-[hsl(var(--color-border))]">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar name={m.user.displayName} url={m.user.avatarUrl} />
                          <div>
                            <div className="font-medium">{m.user.displayName}</div>
                            <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">{m.user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={m.role}
                          onChange={(e) =>
                            updateRole.mutate({
                              projectId,
                              userId: m.userId,
                              role: e.target.value as MemberRole,
                            })
                          }
                          disabled={updateRole.isPending}
                          className={`rounded ${roleInfo.tone} px-2 py-0.5 text-[10px] font-medium`}
                        >
                          <option value="ADMIN">管理员</option>
                          <option value="LEADER">组长</option>
                          <option value="MEMBER">成员</option>
                          <option value="VIEWER">观察者</option>
                        </select>
                        {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */}
                        {RoleIcon && null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {m.modules.length > 0 ? (
                            m.modules.map((mod) => (
                              <span key={mod} className="rounded bg-[hsl(var(--color-muted))] px-1.5 py-0.5 text-[9px]">
                                {mod}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-[hsl(var(--color-muted-foreground))]">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        {new Date(m.joinedAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() =>
                            setRemoveConfirm({ userId: m.userId, userName: m.user.displayName })
                          }
                          className="rounded border border-[hsl(var(--color-border))] px-2 py-0.5 text-[10px] hover:bg-red-500/10 hover:text-red-600"
                          title="移除成员"
                        >
                          <X className="size-2.5 inline" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {members.members.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[hsl(var(--color-muted-foreground))]">
                      还没有成员 — 点右上"添加成员"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 集数分配看板 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          集数分配
          {assignments && (
            <span className="ml-2 text-xs font-normal text-[hsl(var(--color-muted-foreground))]">
              共 {assignments.length} 集
            </span>
          )}
        </h2>
        {assignmentsLoading && (
          <div className="text-sm text-[hsl(var(--color-muted-foreground))]">加载中...</div>
        )}
        {assignments && assignments.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {assignments.map((ep) => (
              <div
                key={ep.id}
                className="rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-3"
              >
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium">第 {ep.number} 集</div>
                    {ep.title && (
                      <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        {ep.title}
                      </div>
                    )}
                  </div>
                  <span className="rounded bg-[hsl(var(--color-muted))] px-1.5 py-0.5 text-[9px]">
                    {ep.totalGroups} 组
                  </span>
                </div>
                <div className="space-y-1">
                  {ep.assignments.length > 0 ? (
                    ep.assignments.map((a) => {
                      const ar = ASSIGN_ROLE_LABELS[a.role as AssignRole];
                      return (
                        <div key={a.id} className="flex items-center gap-2 text-[10px]">
                          <Avatar name={a.user.displayName} url={a.user.avatarUrl} />
                          <span className="flex-1 truncate">{a.user.displayName}</span>
                          <span className={`rounded ${ar.tone} px-1.5 py-0.5 font-medium`}>
                            {ar.label}
                          </span>
                          <button
                            onClick={() => unassign.mutate({ assignmentId: a.id })}
                            disabled={unassign.isPending}
                            className="text-[hsl(var(--color-muted-foreground))] hover:text-red-600"
                            title="取消分配"
                          >
                            <X className="size-2.5" />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">未分配</div>
                  )}
                </div>
                <button
                  onClick={() =>
                    setAssignFor({
                      episodeId: ep.id,
                      episodeLabel: `第 ${ep.number} 集${ep.title ? ' · ' + ep.title : ''}`,
                    })
                  }
                  className="mt-2 w-full rounded border border-dashed border-[hsl(var(--color-border))] py-1 text-[10px] text-[hsl(var(--color-muted-foreground))] hover:border-[hsl(var(--color-foreground))] hover:text-[hsl(var(--color-foreground))]"
                >
                  + 分配
                </button>
              </div>
            ))}
          </div>
        )}
        {assignments && assignments.length === 0 && (
          <div className="rounded-md border border-dashed border-[hsl(var(--color-border))] p-8 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
            项目还没有集数 — 先去导演工作台创建剧本
          </div>
        )}
      </section>

      {/* 对话框 */}
      {addOpen && (
        <AddMemberDialog
          projectId={projectId}
          onClose={() => setAddOpen(false)}
          onSuccess={() => {
            void utils.project.listMembers.invalidate({ projectId });
            setAddOpen(false);
          }}
        />
      )}
      {assignFor && (
        <AssignDialog
          projectId={projectId}
          episodeId={assignFor.episodeId}
          episodeLabel={assignFor.episodeLabel}
          onClose={() => setAssignFor(null)}
          onSuccess={() => {
            void utils.project.listAssignments.invalidate({ projectId });
            setAssignFor(null);
          }}
        />
      )}
      {removeConfirm && (
        <ConfirmDialog
          title={`移除 ${removeConfirm.userName}?`}
          description="该用户将无法访问本项目。已分配到该用户的集也会保留(可手动取消)。"
          confirmLabel="确认移除"
          danger
          onConfirm={() => removeMember.mutate({ projectId, userId: removeConfirm.userId })}
          onClose={() => setRemoveConfirm(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子对话框
// ---------------------------------------------------------------------------

function AddMemberDialog({
  projectId,
  onClose,
  onSuccess,
}: {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}): React.ReactElement {
  const [q, setQ] = React.useState('');
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [selectedName, setSelectedName] = React.useState<string>('');
  const [role, setRole] = React.useState<MemberRole>('MEMBER');

  const { data: searchResults } = trpc.project.searchAddableUsers.useQuery(
    { projectId, q },
    { enabled: q.trim().length > 0 },
  );

  const addMember = trpc.project.addMember.useMutation({
    onSuccess: () => {
      toast.success(`已添加 ${selectedName}`);
      onSuccess();
    },
    onError: (e) => toast.error(`添加失败:${e.message}`),
  });

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
          <h3 className="text-sm font-semibold">添加项目成员</h3>
        </header>
        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium">搜索用户</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--color-muted-foreground))]" />
              <input
                type="text"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSelectedUserId(null);
                }}
                placeholder="email / username / displayName"
                className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] py-2 pl-7 pr-2 text-xs outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
            {searchResults && searchResults.length > 0 && q.trim() && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[hsl(var(--color-border))]">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setSelectedUserId(u.id);
                      setSelectedName(u.displayName);
                      setQ(u.displayName);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[hsl(var(--color-muted))] ${
                      selectedUserId === u.id ? 'bg-blue-500/10' : ''
                    }`}
                  >
                    <Avatar name={u.displayName} url={u.avatarUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{u.displayName}</div>
                      <div className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
                        @{u.username} · {u.email}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {q.trim() && searchResults && searchResults.length === 0 && (
              <div className="mt-2 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                没有找到匹配的可邀请用户(或已是成员)
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">初始角色</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
            >
              <option value="MEMBER">成员(默认)</option>
              <option value="LEADER">组长</option>
              <option value="ADMIN">管理员</option>
              <option value="VIEWER">观察者(只读)</option>
            </select>
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
            onClick={() =>
              selectedUserId &&
              addMember.mutate({
                projectId,
                userId: selectedUserId,
                role,
                modules: ['director', 'art', 'aigc', 'edit', 'library', 'analytics'],
              })
            }
            disabled={!selectedUserId || addMember.isPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            添加
          </button>
        </footer>
      </div>
    </div>
  );
}

function AssignDialog({
  projectId,
  episodeId,
  episodeLabel,
  onClose,
  onSuccess,
}: {
  projectId: string;
  episodeId: string;
  episodeLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}): React.ReactElement {
  const [userId, setUserId] = React.useState<string>('');
  const [role, setRole] = React.useState<AssignRole>('COLLAB');

  // 复用 React Query 缓存,不会真发新请求
  const { data: members } = trpc.project.listMembers.useQuery({ projectId });

  const assign = trpc.project.assignUserToEpisode.useMutation({
    onSuccess: (data) => {
      toast.success(data.alreadyExisted ? '已存在该分配' : '分配成功');
      onSuccess();
    },
    onError: (e) => toast.error(`分配失败:${e.message}`),
  });

  const candidates: Array<{ id: string; name: string; email: string; isOwner: boolean }> =
    members
      ? [
          ...(members.owner
            ? [
                {
                  id: members.owner.id,
                  name: members.owner.displayName,
                  email: members.owner.email,
                  isOwner: true,
                },
              ]
            : []),
          ...members.members.map((m) => ({
            id: m.userId,
            name: m.user.displayName,
            email: m.user.email,
            isOwner: false,
          })),
        ]
      : [];

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
          <h3 className="text-sm font-semibold">分配 {episodeLabel}</h3>
        </header>
        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium">分配给</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
            >
              <option value="">选择项目成员...</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.isOwner ? ' (owner)' : ''} · {c.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">角色</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AssignRole)}
              className="w-full rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-2 py-1.5 text-xs"
            >
              <option value="OWNER">主负责人</option>
              <option value="COLLAB">协作者</option>
              <option value="REVIEWER">审核人</option>
            </select>
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
            onClick={() => userId && assign.mutate({ episodeId, userId, role })}
            disabled={!userId || assign.isPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            分配
          </button>
        </footer>
      </div>
    </div>
  );
}
