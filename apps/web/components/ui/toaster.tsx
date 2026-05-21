'use client';
import { Toaster as SonnerToaster } from 'sonner';
import * as React from 'react';

export function Toaster(): React.ReactElement {
  // 跟随当前主题自动切换 sonner 主题
  const [theme, setTheme] = React.useState<'light' | 'dark'>('dark');

  React.useEffect(() => {
    const root = document.documentElement;
    setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    const obs = new MutationObserver(() => {
      setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    });
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      theme={theme}
      duration={3000}
      toastOptions={{
        style: {
          background: 'hsl(var(--popover))',
          border: '1px solid hsl(var(--border))',
          color: 'hsl(var(--popover-fg))',
          fontSize: '13px',
          borderRadius: '6px',
        },
        className: 'font-sans',
      }}
    />
  );
}

export { toast } from 'sonner';
