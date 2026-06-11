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
import { ASPECT_RATIOS } from '@ss/shared/constants';

const PROJECT_TYPES = ['AI_REAL', 'ANIM_3D', 'ANIM_2D', 'POSTER'] as const;
type ProjectType = (typeof PROJECT_TYPES)[number];
type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** 编辑模式传入的项目最小字段(列表行提供) */
export interface EditableProject {
  id: string;
  name: string;
  type: string;
  aspect: string;
  description?: string | null;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
  project,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  /** 传入 = 「编辑」模式(预填 + 调 project.update);不传 = 「创建」模式 */
  project?: EditableProject | null;
}): React.ReactElement {
  const t = useTranslations();
  const isEdit = !!project;
  const utils = trpc.useUtils();
  const create = trpc.project.create.useMutation({ onSuccess: () => onCreated() });
  const update = trpc.project.update.useMutation({
    onSuccess: () => {
      // 七二第九波:改项目 aspect 后,AIGC 页 getGroupDetail 内嵌的 project.aspect 需失效,
      //   否则预览窗口读旧缓存;与 useVideoSettings 跟随逻辑合起来闭环「改项目 → 预览自动调整」。
      void utils.aigc.getGroupDetail.invalidate();
      onCreated();
    },
  });
  const pending = isEdit ? update.isPending : create.isPending;
  const errorMsg = (isEdit ? update.error : create.error)?.message;

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<ProjectType>('AI_REAL');
  const [aspect, setAspect] = React.useState<AspectRatio>('9:16');
  const [description, setDescription] = React.useState('');

  // 打开时同步表单:编辑模式预填当前值,创建模式重置为默认(原创建对话框每次打开清空)
  React.useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setType((project?.type as ProjectType) ?? 'AI_REAL');
    setAspect((project?.aspect as AspectRatio) ?? '9:16');
    setDescription(project?.description ?? '');
  }, [open, project]);

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    // 编辑模式传实际值(空串 = 清空原简介);创建模式空串转 undefined(不设)。
    //   编辑时若也走 `|| undefined`,清空会丢字段 → Prisma 不更新 → 旧简介残留。
    const data = {
      name,
      type,
      aspect,
      description: isEdit ? description : description || undefined,
    };
    if (isEdit && project) {
      update.mutate({ id: project.id, data });
    } else {
      create.mutate(data);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? '编辑项目 / Edit' : t('modules.missionControl.newProject')}
          </DialogTitle>
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
          {errorMsg && (
            <p className="text-sm text-[hsl(var(--color-destructive))]">{errorMsg}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !name}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? '保存 / Save' : t('actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
