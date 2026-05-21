'use client';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PROJECT_TYPES = ['AI_REAL', 'ANIM_3D', 'ANIM_2D', 'POSTER'] as const;
const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const create = trpc.project.create.useMutation({
    onSuccess: () => onCreated(),
  });

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<(typeof PROJECT_TYPES)[number]>('AI_REAL');
  const [aspect, setAspect] = React.useState<(typeof ASPECT_RATIOS)[number]>('9:16');
  const [description, setDescription] = React.useState('');

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    create.mutate({ name, type, aspect, description: description || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('modules.missionControl.newProject')}</DialogTitle>
          <DialogDescription>{t('app.tagline')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>项目名 / Name</Label>
            <Input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="重生1983"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>类型 / Type</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="flex h-9 rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-input))] px-3 text-sm"
              >
                {PROJECT_TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {t(`enums.projectType.${tt}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>比例 / Aspect</Label>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value as typeof aspect)}
                className="flex h-9 rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-input))] px-3 text-sm"
              >
                {ASPECT_RATIOS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>简介 / Description</Label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-input))] px-3 py-2 text-sm"
            />
          </div>
          {create.error && (
            <p className="text-sm text-[hsl(var(--color-destructive))]">{create.error.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !name}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
