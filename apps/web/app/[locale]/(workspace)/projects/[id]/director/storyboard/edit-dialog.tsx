'use client';
import * as React from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

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

// ---------------------------------------------------------------------------
// Shot 编辑弹窗 — 改 framing/angle/movement/lighting/content/prompt,自动写 PromptEdit
// W7 followup:扩展 4 大预设 — movement/lighting 与 admin.preset 联动
// ---------------------------------------------------------------------------

interface ShotEditInput {
  id: string;
  number: string;
  framing: string | null;
  angle: string | null;
  movement: string | null;
  lighting: string | null;
  content: string;
  prompt: string;
  durationS: number;
  priority: 'S' | 'A' | 'B' | 'C' | null;
}

export function ShotEditDialog({
  shot,
  onClose,
  onSaved,
}: {
  shot: ShotEditInput;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [framing, setFraming] = React.useState(shot.framing ?? '');
  const [angle, setAngle] = React.useState(shot.angle ?? '');
  const [movement, setMovement] = React.useState(shot.movement ?? '');
  const [lighting, setLighting] = React.useState(shot.lighting ?? '');
  const [content, setContent] = React.useState(shot.content);
  const [prompt, setPrompt] = React.useState(shot.prompt);
  const [diffNote, setDiffNote] = React.useState('');

  const update = trpc.storyboard.updateShot.useMutation({
    onSuccess: () => {
      toast.success('已保存 · 改动已记录到 PromptEdit 训练集');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const hasChanges =
    framing !== (shot.framing ?? '') ||
    angle !== (shot.angle ?? '') ||
    movement !== (shot.movement ?? '') ||
    lighting !== (shot.lighting ?? '') ||
    content !== shot.content ||
    prompt !== shot.prompt;

  const handleSave = (): void => {
    if (!hasChanges) {
      toast.info('没有改动');
      return;
    }
    // movement/lighting:空串映射成 null(明确清除字段),非空写入
    const cleanOrNull = (v: string, was: string | null): string | null | undefined => {
      const next = v.trim();
      const cur = was ?? '';
      if (next === cur) return undefined;
      return next.length === 0 ? null : next;
    };
    update.mutate({
      shotId: shot.id,
      patch: {
        framing: framing !== (shot.framing ?? '') ? framing : undefined,
        angle: angle !== (shot.angle ?? '') ? angle : undefined,
        movement: cleanOrNull(movement, shot.movement),
        lighting: cleanOrNull(lighting, shot.lighting),
        content: content !== shot.content ? content : undefined,
        prompt: prompt !== shot.prompt ? prompt : undefined,
      },
      diffNote: diffNote || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>编辑分镜 {shot.number}</DialogTitle>
          <DialogDescription>
            修改任何字段后保存会自动写入 PromptEdit 表,作为未来 AI 优化的训练样本。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {/* W7 audit R6:景别 / 角度 / 运镜 / 光线 4 大预设字段,
                datalist 模式拉 me.presets,兼容自定义值(预设外字符串作训练数据) */}
            <PresetField
              id="framing"
              label="景别"
              kind="framing"
              value={framing}
              onChange={setFraming}
              placeholder="特写 / 近景 / 中景"
            />
            <PresetField
              id="angle"
              label="角度"
              kind="angle"
              value={angle}
              onChange={setAngle}
              placeholder="平视 / 过肩 / 俯角"
            />
            <PresetField
              id="movement"
              label="运镜"
              kind="movement"
              value={movement}
              onChange={setMovement}
              placeholder="固定 / 推 / 拉 / 摇 / 跟"
            />
            <PresetField
              id="lighting"
              label="光线"
              kind="lighting"
              value={lighting}
              onChange={setLighting}
              placeholder="自然光 / 硬光 / 逆光"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="content">剧本内容</Label>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={2}
              className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 text-sm"
              placeholder="30 字内描述这一镜的画面"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="prompt">视频提示词(含台词/OS)</Label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 font-mono text-[12px] leading-relaxed"
              placeholder="景别 + 角度 + 主体 + 环境 + 表情 + 动作;台词放末尾"
            />
            <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              {prompt.length} 字 · 建议 100-150 字
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="diffNote" className="flex items-center gap-1.5">
              <Sparkles className="size-3 text-[hsl(var(--color-accent))]" />
              修改原因(可选,会一起入训练集)
            </Label>
            <Input
              id="diffNote"
              value={diffNote}
              onChange={(e) => setDiffNote(e.target.value)}
              placeholder="例:AI 生成的镜头景别过近,改成中景"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || update.isPending} className="gap-1.5">
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Group 编辑弹窗 — 改 number / prompt
// ---------------------------------------------------------------------------

interface GroupEditInput {
  id: string;
  number: string;
  prompt: string;
  durationS: number;
}

export function GroupEditDialog({
  group,
  onClose,
  onSaved,
}: {
  group: GroupEditInput;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [number, setNumber] = React.useState(group.number);
  const [prompt, setPrompt] = React.useState(group.prompt);
  const [diffNote, setDiffNote] = React.useState('');

  const update = trpc.storyboard.updateGroup.useMutation({
    onSuccess: () => {
      toast.success('已保存 · 改动已记录到 PromptEdit 训练集');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const hasChanges = number !== group.number || prompt !== group.prompt;

  const handleSave = (): void => {
    if (!hasChanges) {
      toast.info('没有改动');
      return;
    }
    update.mutate({
      groupId: group.id,
      patch: {
        number: number !== group.number ? number : undefined,
        prompt: prompt !== group.prompt ? prompt : undefined,
      },
      diffNote: diffNote || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>编辑合并组 {group.number}</DialogTitle>
          <DialogDescription>
            组级提示词是送给视频生成模型的最终 prompt({group.durationS.toFixed(1)}s 一次生成),改动会入训练集。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="number">组号</Label>
            <Input
              id="number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="如 1-8 / 9-18 / 1-8a"
              className="font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="prompt">组级提示词(含台词/OS)</Label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={14}
              className="rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-3 py-2 font-mono text-[12px] leading-relaxed"
            />
            <p className="text-[10px] text-[hsl(var(--color-muted-foreground))]">
              {prompt.length} 字
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="diffNote" className="flex items-center gap-1.5">
              <Sparkles className="size-3 text-[hsl(var(--color-accent))]" />
              修改原因(可选,会一起入训练集)
            </Label>
            <Input
              id="diffNote"
              value={diffNote}
              onChange={(e) => setDiffNote(e.target.value)}
              placeholder="例:AI 拼接的提示词台词顺序乱了,人工重排"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || update.isPending} className="gap-1.5">
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// W7 audit R6:PresetField — input + datalist 模式
// 业务侧拉 me.presets 提供下拉选项,但仍允许自定义输入(用户输预设外字符串作训练数据)
// ---------------------------------------------------------------------------

function PresetField({
  id,
  label,
  kind,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  kind: 'framing' | 'angle' | 'movement' | 'lighting';
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const { data: presets } = trpc.me.presets.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const options = presets?.find((p) => p.kind === kind)?.values ?? [];

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={`preset-${kind}`}
      />
      <datalist id={`preset-${kind}`}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </div>
  );
}
