'use client';
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Languages, Check } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LABELS: Record<string, string> = {
  'zh-CN': '简体中文',
  en: 'English',
};

export function LanguageSwitcher(): React.ReactElement {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchTo = (next: string): void => {
    const re = /^\/(zh-CN|en)(\/|$)/;
    const rest = pathname.replace(re, '/');
    router.push(`/${next}${rest}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="切换语言">
          <Languages className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {Object.entries(LABELS).map(([code, label]) => (
          <DropdownMenuItem
            key={code}
            onClick={() => switchTo(code)}
            className={code === locale ? 'bg-[hsl(var(--color-secondary))]' : ''}
          >
            <span className="flex-1 text-[12px]">{label}</span>
            {code === locale && <Check className="size-3 text-[hsl(var(--color-accent))]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
