'use client';

import * as React from 'react';

import { trpc } from '@/lib/trpc/client';

/**
 * W5.5 D4 + 第 2 轮 audit L1 提前到 Phase 1:AIGC 视频生成实时进度 hook
 *
 * 内部流程:
 *   1. 调 tRPC `aigc.getStreamToken(attemptId)` 拿 HMAC 5min token
 *   2. 建 EventSource(`/api/sse/aigc/${attemptId}?token=...`)
 *   3. 监听 running/progress/success/failed 事件,维护状态机
 *   4. 终态后自动 close + cleanup
 *   5. attemptId 变 null / 组件 unmount 时清理
 *   6. **第 2 轮 audit L1**:EventSource 自动重连失败(readyState=CLOSED)时自动重签 token
 *      场景:用户开工作台离开 30min+,5min HMAC token 过期 → 浏览器自动重连用旧 token 401
 *      修复:onerror 触发且 CLOSED 时,重新调 getStreamToken 拿新 token,重建 EventSource
 *
 * 注意:浏览器内置自动重连用旧 token,Phase 1 我们补一层 hook 级别重连续期。
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

  // ref 防 mutation 引用每次 render 变化导致 useEffect 重跑
  const mutateRef = React.useRef(getTokenMutation.mutateAsync);
  mutateRef.current = getTokenMutation.mutateAsync;

  React.useEffect(() => {
    if (!attemptId) {
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    let eventSource: EventSource | undefined;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 3; // 防无限重连(用户不在页面 / 后端死)

    setState({ kind: 'connecting' });

    const attachListeners = (es: EventSource): void => {
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
        es.close();
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
        es.close();
      };

      es.addEventListener('running', onRunning);
      es.addEventListener('progress', onProgress as EventListener);
      es.addEventListener('success', onSuccess as EventListener);
      es.addEventListener('failed', onFailed as EventListener);

      es.onerror = (): void => {
        // EventSource 自带重连(用旧 token,token 过期会一直 401);只有 readyState=CLOSED 才需要手动续期
        if (es.readyState !== EventSource.CLOSED) return;
        if (cancelled) return;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.warn(
            `[sse] reconnect attempts exhausted (${MAX_RECONNECT_ATTEMPTS}) for ${attemptId}`,
          );
          setState({
            kind: 'failed',
            errorMsg: 'connection closed (reconnect attempts exhausted)',
            retryable: true,
          });
          return;
        }
        reconnectAttempts += 1;
        console.log(
          `[sse] connection closed, reconnecting attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`,
        );
        // 第 2 轮 audit L1:重签新 token + 重建 EventSource
        void reconnect();
      };
    };

    const reconnect = async (): Promise<void> => {
      if (cancelled || !attemptId) return;
      try {
        const { token } = await mutateRef.current({ attemptId });
        if (cancelled) return;
        eventSource = new EventSource(`/api/sse/aigc/${attemptId}?token=${token}`);
        attachListeners(eventSource);
      } catch (err) {
        if (!cancelled) {
          console.error('[useAigcProgress] reconnect failed:', err);
          setState({
            kind: 'failed',
            errorMsg: err instanceof Error ? err.message : 'reconnect failed',
            retryable: true,
          });
        }
      }
    };

    // 首次连接(共用 reconnect 逻辑,reset attempts 计数为 0)
    void (async () => {
      try {
        const { token } = await mutateRef.current({ attemptId });
        if (cancelled) return;
        eventSource = new EventSource(`/api/sse/aigc/${attemptId}?token=${token}`);
        attachListeners(eventSource);
      } catch (err) {
        if (!cancelled) {
          console.error('[useAigcProgress] failed to obtain stream token:', err);
          setState({
            kind: 'failed',
            errorMsg:
              err instanceof Error ? err.message : 'failed to obtain stream token',
            retryable: false,
          });
        }
      }
    })();

    return (): void => {
      cancelled = true;
      eventSource?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  return state;
}
