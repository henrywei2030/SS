'use client';
import Link from 'next/link';
import { Plus, FileText, Sparkles, Loader2 } from 'lucide-react';
import * as React from 'react';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

export function ScriptList({ projectId, locale }: { projectId: string; locale: string }): React.ReactElement {
  const { data, refetch } = trpc.script.list.useQuery({ projectId });
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} className="gap-1.5">
          <Plus className="size-4" /> 上传剧本
        </Button>
      </div>

      {data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <Card key={s.id} className="card-hover">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    第 {s.episode?.number} 集 {s.title ?? ''}
                  </CardTitle>
                  <Badge variant="secondary">v{s.version}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-xs text-[hsl(var(--color-muted-foreground))]">
                  <span>{s.content.slice(0, 80)}...</span>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  {s.analyses[0] ? (
                    <Badge variant="success">
                      已分析 · {Number(s.analyses[0].overallScore ?? 0).toFixed(1)} / 10
                    </Badge>
                  ) : (
                    <Badge variant="warning">未分析</Badge>
                  )}
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <Link href={`/${locale}/projects/${projectId}/director/analysis?script=${s.id}`}>
                      <Sparkles className="size-3.5" /> 分析
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="py-24 text-center">
          <FileText className="mx-auto size-12 text-[hsl(var(--color-muted-foreground))]" />
          <p className="mt-4 text-sm text-[hsl(var(--color-muted-foreground))]">还没有剧本，上传第一集开始</p>
          <Button onClick={() => setOpen(true)} className="mt-4">
            <Plus className="size-4" /> 上传剧本
          </Button>
        </Card>
      )}

      <UploadDialog
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        onUploaded={() => {
          void refetch();
          setOpen(false);
        }}
      />
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  projectId,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onUploaded: () => void;
}): React.ReactElement {
  const [episodeNumber, setEpisodeNumber] = React.useState(1);
  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const upload = trpc.script.upload.useMutation({ onSuccess: onUploaded });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>上传剧本 / Upload Script</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>集数</Label>
              <Input
                type="number"
                min={1}
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(Number(e.target.value))}
              />
            </div>
            <div className="col-span-2 grid gap-2">
              <Label>本集标题（可选）</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>剧本内容</Label>
            <textarea
              rows={12}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="粘贴剧本全文..."
              className="rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-input))] px-3 py-2 font-mono text-xs"
            />
          </div>
          {upload.error && (
            <p className="text-sm text-[hsl(var(--color-destructive))]">{upload.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={() =>
              upload.mutate({
                projectId,
                episodeNumber,
                title: title || undefined,
                content,
              })
            }
            disabled={upload.isPending || !content}
          >
            {upload.isPending && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
