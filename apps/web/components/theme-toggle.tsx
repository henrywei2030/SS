'use client';

/**
 * Theme Toggle — 明亮 / 深夜一键切换
 *
 * 策略：
 *   - localStorage key: 'ss-theme' = 'light' | 'dark'
 *   - 默认 = 'dark'（Cursor 同款默认深夜）
 *   - 切换时 toggle <html> 上的 'dark' 类
 *   - 配合 root layout 的内联 inline 脚本防 FOUC（无闪烁）
 */
import { Moon, Sun } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';

export const THEME_STORAGE_KEY = 'ss-theme';

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function ThemeToggle({ className }: { className?: string }): React.ReactElement {
  const [theme, setTheme] = React.useState<Theme>('dark');
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setTheme(getInitialTheme());
    setMounted(true);
  }, []);

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const root = document.documentElement;
    if (next === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* localStorage 可能被禁用 */
    }
  }

  if (!mounted) {
    // 占位以避免 hydration mismatch
    return (
      <Button variant="ghost" size="icon" className={className} aria-label="主题切换">
        <Sun className="size-3.5 opacity-0" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={className}
      aria-label={theme === 'dark' ? '切换到明亮模式' : '切换到深夜模式'}
      title={theme === 'dark' ? '明亮模式' : '深夜模式'}
    >
      {theme === 'dark' ? (
        <Sun className="theme-toggle-icon size-3.5" />
      ) : (
        <Moon className="theme-toggle-icon size-3.5" />
      )}
    </Button>
  );
}

/**
 * 内联脚本字符串 — 由 root layout 注入 <head>，在 React 水合前同步执行
 * 这样首屏不会闪现错误主题（FOUC）
 */
export const THEME_INIT_SCRIPT = `(function() {
  try {
    var k = '${THEME_STORAGE_KEY}';
    var stored = localStorage.getItem(k);
    var dark = stored === 'dark' || (!stored && true);
    if (dark) {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.theme = 'dark';
    } else {
      document.documentElement.dataset.theme = 'light';
    }
  } catch (e) {}
})();`;
