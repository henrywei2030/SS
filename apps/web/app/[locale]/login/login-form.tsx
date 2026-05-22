'use client';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { LogoLockup } from '@/components/brand/logo';

export function LoginForm({ redirectTo }: { redirectTo: string | null }): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const [identifier, setIdentifier] = React.useState('admin@starsalign.local');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        credentials: 'include',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? t('auth.errors.invalidCredentials'));
      }
      // 防开放重定向:`//evil.com/path` 也以 `/` 开头但被浏览器视作 protocol-relative
      const isSafeRedirect =
        !!redirectTo &&
        redirectTo.startsWith('/') &&
        !redirectTo.startsWith('//') &&
        !redirectTo.startsWith('/\\');
      const next = isSafeRedirect ? redirectTo : `/${params.locale}/projects`;
      router.push(next);
      router.refresh();
    } catch (e) {
      toast.error(t('auth.errors.invalidCredentials'), {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 大 logo + 双行品牌 + 副标语 */}
      <LogoLockup size="lg" />

      {/* 表单卡 */}
      <div className="rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label
              htmlFor="identifier"
              className="text-[12px] font-normal text-[hsl(var(--color-muted-foreground))]"
            >
              邮箱或用户名
            </Label>
            <Input
              id="identifier"
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label
              htmlFor="password"
              className="text-[12px] font-normal text-[hsl(var(--color-muted-foreground))]"
            >
              密码
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" disabled={loading || !password} className="mt-1 w-full">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            登录
          </Button>
        </form>
      </div>

      {/* 帮助 */}
      <p className="text-center text-[12px] text-[hsl(var(--color-muted-foreground))]">
        遇到问题？{' '}
        <a className="text-[hsl(var(--color-accent))] hover:underline" href="#">
          联系管理员
        </a>
      </p>
    </div>
  );
}
