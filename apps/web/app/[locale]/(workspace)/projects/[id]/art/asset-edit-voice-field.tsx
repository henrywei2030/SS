'use client';
import * as React from 'react';
import { Loader2, X, Upload, Music, Sparkles, Wand2 } from 'lucide-react';
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
  // M2′ 声线小工具:掐头尾静音 + 响度归一(-16 LUFS)+ 截 15s,产新版本可回退
  const normalizeMut = trpc.asset.normalizeVoice.useMutation({
    onSuccess: (r) => {
      toast.success(
        `已规范化:${r.beforeDurationS != null ? `${r.beforeDurationS.toFixed(1)}s → ` : ''}${r.afterDurationS.toFixed(1)}s · 响度 -16 LUFS(原音频保留在素材库)`,
      );
      onChanged();
    },
    onError: (e) => toast.error(`规范化失败:${e.message}`),
  });

  // TTS-B:按设定生成声线样本(本地 MOSS-TTS-Nano,免费)— 异步 job,完成后自动设为参考音频
  const [seedVoice, setSeedVoice] = React.useState('builtin:Yuewen');
  const [generating, setGenerating] = React.useState(false);
  const utils = trpc.useUtils();
  const { data: voiceSeeds } = trpc.asset.listVoiceSeeds.useQuery();

  // 主动轮询:utils.fetch 绕开与详情面板共享的 asset.get useQuery 实例(同 key 去重会吞掉
  // 本组件的 refetchInterval)。voiceMediaId 变化即视为完成;失败走铃铛通知。
  React.useEffect(() => {
    if (!generating) return;
    const startVoice = voiceMediaId;
    let stopped = false;
    let polls = 0;
    // 六七深审 P1:轮询次数上限兜底 — 防权重首次下载卡死/job 永不回填时 interval 无限轮询
    //   (~10min:本地 TTS 5-20s,首次下模型几分钟,200×3s 足够);超限停轮询,完成仍有铃铛通知兜底。
    const MAX_POLLS = 200;
    const timer = setInterval(() => {
      if (stopped) return;
      if (++polls > MAX_POLLS) {
        stopped = true;
        clearInterval(timer);
        setGenerating(false);
        toast.info('声线生成仍在进行,完成后会有铃铛通知并自动更新');
        return;
      }
      void utils.asset.get
        .fetch({ assetId })
        .then((fresh) => {
          const next = (fresh as { voiceMediaId?: string | null })?.voiceMediaId ?? null;
          if (!stopped && next && next !== startVoice) {
            stopped = true;
            clearInterval(timer);
            setGenerating(false);
            toast.success('声线样本已生成并设为参考音频');
            void utils.asset.get.invalidate({ assetId });
            onChanged();
          }
        })
        .catch(() => {});
    }, 3_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // voiceMediaId 进 deps 会在完成时重启轮询;用闭包初值锁定避免
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, assetId]);

  const generateMut = trpc.asset.generateVoiceSample.useMutation({
    onSuccess: (r) => {
      setGenerating(true);
      toast.info(
        r.modelsReady
          ? '声线样本生成中(本地模型,约 5-20s),完成自动设为参考音频'
          : '首次使用:正在自动下载本地 TTS 模型(~850MB,几分钟),完成后自动生成并通知',
      );
    },
    onError: (e) => toast.error(`发起失败:${e.message}`),
  });

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
      {/* M2′:声线规范提示 */}
      <p className="text-[10px] leading-snug text-[hsl(var(--color-muted-foreground))]/80">
        建议 5-15s 干声(无 BGM/噪音/混响),情绪贴角色;上传后可点 ✨ 一键规范化(掐静音+响度归一)
      </p>
      {/* TTS-B:按设定生成(本地 MOSS-TTS-Nano,免费;文案取角色独白/小传) */}
      <div className="flex items-center gap-1.5">
        <select
          value={seedVoice}
          onChange={(e) => setSeedVoice(e.target.value)}
          disabled={generating}
          className="h-7 min-w-0 flex-1 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] px-1.5 text-[11px]"
          title="种子声线(本地模型内置 18 条;克隆=以当前参考音频为声线再生成)"
        >
          {(voiceSeeds?.seeds ?? []).map((s) => (
            <option key={s.name} value={`builtin:${s.name}`}>
              {s.lang === 'zh' ? '中' : s.lang === 'en' ? '英' : '日'} · {s.name}
            </option>
          ))}
          {voiceMediaId && <option value="current">克隆现有参考音频</option>}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={generating || generateMut.isPending}
          onClick={() => generateMut.mutate({ assetId, seedVoice })}
          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
          title={
            voiceSeeds?.ready === false
              ? '首次使用会自动下载本地 TTS 模型(~850MB,几分钟)'
              : '用角色独白/小传文案 + 选中声线本地生成样本(零扣费),完成自动设为参考音频'
          }
        >
          {generating || generateMut.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {generating ? '生成中…' : '按设定生成'}
        </Button>
      </div>
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
            onClick={() => normalizeMut.mutate({ assetId })}
            disabled={busy || normalizeMut.isPending}
            className="shrink-0 rounded p-1 text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-secondary)/0.5)]"
            title="一键规范化:掐头尾静音 + 响度归一 -16 LUFS + 截 15s(原音频保留)"
          >
            {normalizeMut.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wand2 className="size-3.5" />
            )}
          </button>
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
