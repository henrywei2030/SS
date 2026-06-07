'use client';
import * as React from 'react';
import { Loader2, X, Upload, Music } from 'lucide-react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { fileToBase64 } from '@/lib/file-to-base64';

// ---------------------------------------------------------------------------
// 五七-3:参考音频字段(配音参考)— 上传 audio → voiceMediaId;视频生成绑该角色自动带上
// ---------------------------------------------------------------------------

export function VoiceField({
  assetId,
  projectId,
  voiceMediaId,
  onChanged,
}: {
  assetId: string;
  projectId: string;
  voiceMediaId: string | null;
  onChanged: () => void;
}): React.ReactElement {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const upload = trpc.media.upload.useMutation();
  const updateMut = trpc.asset.update.useMutation();
  const { data: signed } = trpc.media.getSignedUrl.useQuery(
    { mediaId: voiceMediaId ?? '', expiresInSeconds: 3600 },
    { enabled: !!voiceMediaId },
  );

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const media = await upload.mutateAsync({
        filename: file.name,
        fileBase64: base64,
        kind: 'AUDIO',
        scope: 'PROJECT',
        projectId,
        mimeType: file.type || undefined,
      });
      await updateMut.mutateAsync({ assetId, patch: { voiceMediaId: media.id } });
      toast.success('参考音频已上传');
      onChanged();
    } catch (err) {
      toast.error(`上传失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      await updateMut.mutateAsync({ assetId, patch: { voiceMediaId: null } });
      toast.success('已清除参考音频');
      onChanged();
    } catch (err) {
      toast.error(`清除失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1">
      <Label className="flex items-center gap-1 text-[10px] text-[hsl(var(--color-muted-foreground))]">
        <Music className="size-3" />
        参考音频(配音参考 · 视频生成绑该角色时自动带上)
      </Label>
      <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleFile} />
      {voiceMediaId ? (
        <div className="flex items-center gap-2">
          {signed?.url ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls src={signed.url} className="h-8 min-w-0 flex-1" />
          ) : (
            <span className="flex-1 text-[11px] text-[hsl(var(--color-muted-foreground))]">
              已上传(加载试听…)
            </span>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="shrink-0 rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
            title="替换"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          </button>
          <button
            onClick={clear}
            disabled={busy}
            className="shrink-0 rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-destructive)/0.1)] hover:text-[hsl(var(--color-destructive))]"
            title="清除"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="h-8 gap-1.5 text-xs"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          上传参考音频
        </Button>
      )}
    </div>
  );
}
