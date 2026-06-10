'use client';
/**
 * 顶栏通知铃铛 — M0 基建(2026-06-10,蓝图 docs/06 §3 M0)
 *
 * 未读数 30s 轮询(蓝图口径);下拉懒加载最新 10 条(打开才查)。
 * 点单条 = 标该条已读;底部「全部已读」。通知由 @ss/core/notify 落库
 * (M1 成片完成 / M4 批量完成等业务方写入,admin 可用 notification.sendTest 联通自检)。
 */
import * as React from 'react';
import { Bell } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpc } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';

function relativeTime(date: Date | string): string {
  const ts = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  const diffS = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffS < 60) return '刚刚';
  if (diffS < 3600) return `${Math.floor(diffS / 60)} 分钟前`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)} 小时前`;
  return `${Math.floor(diffS / 86400)} 天前`;
}

export function NotificationBell(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const utils = trpc.useUtils();

  const unread = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const list = trpc.notification.list.useQuery(
    { limit: 10 },
    { enabled: open },
  );

  const invalidate = (): void => {
    void utils.notification.unreadCount.invalidate();
    void utils.notification.list.invalidate();
  };
  const markRead = trpc.notification.markRead.useMutation({ onSuccess: invalidate });
  const markAllRead = trpc.notification.markAllRead.useMutation({ onSuccess: invalidate });

  const count = unread.data?.count ?? 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-7 w-7"
          aria-label={count > 0 ? `通知(${count} 条未读)` : '通知'}
        >
          <Bell className="size-3.5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[hsl(var(--color-destructive))] px-0.5 text-[9px] font-medium leading-none text-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-[hsl(var(--color-border))] px-3 py-2">
          <span className="text-[12px] font-medium">通知</span>
          {count > 0 && (
            <button
              type="button"
              className="text-[11px] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))]"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              全部已读
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {list.isLoading ? (
            <div className="px-3 py-6 text-center text-[12px] text-[hsl(var(--color-muted-foreground))]">
              加载中…
            </div>
          ) : !list.data || list.data.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-[hsl(var(--color-muted-foreground))]">
              暂无通知
            </div>
          ) : (
            list.data.map((n) => (
              <button
                key={n.id}
                type="button"
                className={cn(
                  'block w-full border-b border-[hsl(var(--color-border))] px-3 py-2 text-left last:border-b-0 hover:bg-[hsl(var(--color-secondary))]',
                  !n.isRead && 'bg-[hsl(var(--color-secondary))]/40',
                )}
                onClick={() => {
                  if (!n.isRead) markRead.mutate({ ids: [n.id] });
                }}
              >
                <div className="flex items-start gap-2">
                  {!n.isRead && (
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[hsl(var(--color-primary))]" />
                  )}
                  <div className={cn('min-w-0 flex-1', n.isRead && 'pl-3.5')}>
                    <div
                      className={cn(
                        'truncate text-[12px]',
                        n.isRead
                          ? 'text-[hsl(var(--color-muted-foreground))]'
                          : 'font-medium text-[hsl(var(--color-foreground))]',
                      )}
                    >
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-[hsl(var(--color-muted-foreground))]">
                        {n.body}
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-[hsl(var(--color-muted-foreground))]">
                      {relativeTime(n.createdAt)}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
