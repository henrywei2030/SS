'use client';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { LogoLockup } from '@/components/brand/logo';

export function ActivateForm({ locale }: { locale: string }): React.ReactElement {
  const router = useRouter();
  const [key, setKey] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
        credentials: 'include',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? '激活失败');
      }
      // 激活成功 → 进登录页
      router.push(`/${locale}/login`);
      router.refresh();
    } catch (e) {
      toast.error('激活失败', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <LogoLockup size="lg" />

      <div className="rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label
              htmlFor="activation-key"
              className="text-[12px] font-normal text-[hsl(var(--color-muted-foreground))]"
            >
              激活密钥
            </Label>
            <Input
              id="activation-key"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              placeholder="SSALIGN-XXXX-XXXX-XXXX"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>

          <Button type="submit" disabled={loading || !key.trim()} className="mt-1 w-full">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            激活并继续
          </Button>
        </form>
      </div>

      <p className="text-center text-[12px] text-[hsl(var(--color-muted-foreground))]">
        首次使用本机需输入激活密钥(每台设备激活一次)
      </p>
    </div>
  );
}
