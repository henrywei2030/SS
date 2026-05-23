'use client';

import * as React from 'react';

import { trpc } from '@/lib/trpc/client';

/**
 * W5.5 D4:AIGC 视频生成实时进度 hook(ADR-25 M9)
 *
 * 内部流程:
 *   1. 调 tRPC `aigc.getStreamToken(attemptId)` 拿 HMAC 5min token
 *   2. 建 EventSource(`/api/sse/aigc/${attemptId}?token=...`)
 *   3. 监听 running/progress/success/failed 事件,维护状态机
 *   4. 终态后自动 close + cleanup
 *   5. attemptId 变 null / 组件 unmount 时清理
 *
 * 注意:EventSource 浏览器自带重连(默认 3s),不需要手动管;只有
 * readyState=CLOSED 时才是真断(此时不会自动恢复)。
 */
export type AigcProgressState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'running' }
  | { kind: 'progress'; percent?: number; message?: string }
  | {
      kind: 'success';
      mediaId: string;
      videoUrl: string;
      thumbnailUrl?: string;
      costCny: number;
    }
  | { kind: 'failed'; errorMsg: string; retryable: boolean };

export function useAigcProgress(attemptId: string | null): AigcProgressState {
  const [state, setState] = React.useState<AigcProgressState>({ kind: 'idle' });
  const getTokenMutation = trpc.aigc.getStreamToken.useMutation();

  // 用 ref 防 mutation 引用每次 render 变化导致 useEffect 重跑
  const mutateRef = React.useRef(getTokenMutation.mutateAsync);
  mutateRef.current = getTokenMutation.mutateAsync;

  React.useEffect(() => {
    if (!attemptId) {
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    let eventSource: EventSource | undefined;
    setState({ kind: 'connecting' });

    void (async () => {
      try {
        const { token } = await mutateRef.current({ attemptId });
        if (cancelled) return;

        eventSource = new EventSource(`/api/sse/aigc/${attemptId}?token=${token}`);

        const onRunning = (): void => setState({ kind: 'running' });

        const onProgress = (e: MessageEvent): void => {
          try {
            const data = JSON.parse(e.data);
            setState({
              kind: 'progress',
              percent: typeof data.percent === 'number' ? data.percent : undefined,
              message: typeof data.message === 'string' ? data.message : undefined,
            });
          } catch {
            // ignore parse error
          }
        };

        const onSuccess = (e: MessageEvent): void => {
          try {
            const data = JSON.parse(e.data);
            setState({
              kind: 'success',
              mediaId: data.mediaId ?? '',
              videoUrl: data.videoUrl ?? '',
              thumbnailUrl: data.thumbnailUrl,
              costCny: Number(data.costCny ?? 0),
            });
          } catch {
            setState({
              kind: 'failed',
              errorMsg: 'parse success event failed',
              retryable: false,
            });
          }
          eventSource?.close();
        };

        const onFailed = (e: MessageEvent): void => {
          try {
            const data = JSON.parse(e.data);
            setState({
              kind: 'failed',
              errorMsg: data.errorMsg ?? 'unknown',
              retryable: !!data.retryable,
            });
          } catch {
            setState({ kind: 'failed', errorMsg: 'unknown', retryable: false });
          }
          eventSource?.close();
        };

        eventSource.addEventListener('running', onRunning);
        eventSource.addEventListener('progress', onProgress as EventListener);
        eventSource.addEventListener('success', onSuccess as EventListener);
        eventSource.addEventListener('failed', onFailed as EventListener);

        eventSource.onerror = (): void => {
          // EventSource 自带重连;只有 readyState=CLOSED 才是真断
          if (eventSource?.readyState === EventSource.CLOSED) {
            console.warn(`[sse] connection closed for ${attemptId}`);
          }
        };
      } catch (err) {
        if (!cancelled) {
          console.error('[useAigcProgress] failed to obtain stream token:', err);
          setState({
            kind: 'failed',
            errorMsg: err instanceof Error ? err.message : 'failed to obtain stream token',
            retryable: false,
          });
        }
      }
    })();

    return (): void => {
      cancelled = true;
      eventSource?.close();
    };
    // mutateRef 是 stable(ref),不进依赖;getTokenMutation 整体引用变化但内部函数 ref 已固化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  return state;
}
