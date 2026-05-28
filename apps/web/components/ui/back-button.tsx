'use client';
import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * 通用返回按钮(三十六收工 UX 改造)
 *
 * 设计原则:
 *   - 接 `href` 显式指定父路由,不依赖浏览器历史(防 SPA push 计数不准 / 外部链接初次访问)
 *   - 默认 label "返回",可自定义("返回剧本管理" / "返回项目首页" 等)
 *   - 紧凑 chip 样式,放在页面顶部 toolbar 左侧
 *
 * 用法:
 *   <BackButton href="/zh/projects/abc/director/storyboard?tab=script" label="返回剧本管理" />
 */
export interface BackButtonProps {
  /** 父路由 href(显式指定,不依赖 router.back()) */
  href: string;
  /** 按钮文字,默认"返回" */
  label?: string;
  /** 额外 className */
  className?: string;
}

export function BackButton({
  href,
  label = '返回',
  className,
}: BackButtonProps): React.ReactElement {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-2 text-xs text-[hsl(var(--color-muted-foreground))] transition-colors hover:border-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-muted))] hover:text-[hsl(var(--color-foreground))]',
        className,
      )}
    >
      <ChevronLeft className="size-3.5" />
      {label}
    </Link>
  );
}
