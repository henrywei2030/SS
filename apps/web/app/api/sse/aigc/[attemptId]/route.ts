/**
 * SSE Endpoint — AIGC 视频生成进度推送(ADR-25 M5/M6)
 *
 * GET /api/sse/aigc/[attemptId]?token=xxx
 *
 * 流程:
 *   1. 校 HMAC token(verifyStreamToken)+ 匹配 URL attemptId(防 token 跨资源)
 *   2. 进入时查 DB 兜底:已 SUCCESS/FAILED 立即推一条终态事件后关闭(防错过早期消息)
 *   3. 否则订阅 Redis pub/sub `videogen:attempt:{id}` channel
 *   4. 收到 worker 推的 running/progress/success/failed 事件,format SSE 推前端
 *   5. 终态(success/failed)后 controller.close()
 *   6. 30 分钟无消息自动 server 关闭(防泄漏)+ client abort 时清理
 *
 * 注意:必须 Node runtime(ioredis 用 net),不能 edge runtime
 */
import type { NextRequest } from 'next/server';

import { prisma } from '@ss/db';
import { getProgressBus, type ProgressSubscription } from '@ss/queue/progress-bus';
import { verifyStreamToken } from '@ss/queue/sse-token';
import { type VideoGenProgressEvent } from '@ss/queue/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_MAX_MS = 30 * 60_000; // 30 分钟硬上限

function sseFormat(event: VideoGenProgressEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

type AttemptTerminalRow = {
  status: string;
  outputMediaId: string | null;
  errorMsg: string | null;
  costCny: unknown;
} | null;

/**
 * 终态兜底推送(12 维深审:进入时 + subscribe 后 double-check 两处同款 ~50 行收敛单一真相源)。
 * attempt 已 SUCCESS/FAILED → 推一条对应事件并返回 true(调用方负责 close);未终态返回 false。
 * SUCCESS 但 media 缺失/被软删 → 按 failed 推(第 2 轮 audit P0-2:防前端空 <video>)。
 */
async function pushTerminalIfDone(
  attemptId: string,
  row: AttemptTerminalRow,
  send: (event: VideoGenProgressEvent) => void,
): Promise<boolean> {
  if (!row) return false;
  if (row.status === 'FAILED') {
    send({ type: 'failed', attemptId, errorMsg: row.errorMsg ?? 'unknown', retryable: false });
    return true;
  }
  if (row.status !== 'SUCCESS') return false;
  if (!row.outputMediaId) {
    send({
      type: 'failed',
      attemptId,
      errorMsg: 'success_but_no_media: attempt.outputMediaId 为空',
      retryable: false,
    });
    return true;
  }
  const m = await prisma.mediaItem.findFirst({
    where: { id: row.outputMediaId, deletedAt: null },
    select: { id: true, cdnUrl: true, meta: true },
  });
  if (!m || !m.cdnUrl) {
    send({
      type: 'failed',
      attemptId,
      errorMsg: 'media_deleted_or_missing: MediaItem 已被删除或缺 cdnUrl',
      retryable: false,
    });
    return true;
  }
  const meta = (m.meta as Record<string, unknown> | null) ?? {};
  const thumbnailUrl = typeof meta.thumbnailUrl === 'string' ? meta.thumbnailUrl : undefined;
  send({
    type: 'success',
    attemptId,
    mediaId: m.id,
    videoUrl: m.cdnUrl,
    thumbnailUrl,
    costCny: Number(row.costCny ?? 0),
  });
  return true;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const { attemptId } = await params;
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return new Response('missing token', { status: 401 });
  }
  const payload = verifyStreamToken(token);
  if (!payload) {
    return new Response('invalid or expired token', { status: 401 });
  }
  if (payload.attemptId !== attemptId) {
    return new Response('token-resource mismatch', { status: 403 });
  }

  // 兜底:进入时查 DB,已终态直接推一条 + close(防 worker publish 时还没 SSE 订阅丢消息)
  const attempt = await prisma.generationAttempt.findUnique({
    where: { id: attemptId },
    select: {
      status: true,
      outputMediaId: true,
      errorMsg: true,
      costCny: true,
    },
  });
  if (!attempt) {
    return new Response('attempt not found', { status: 404 });
  }

  let subscription: ProgressSubscription | undefined;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: VideoGenProgressEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFormat(event)));
        } catch {
          // controller already closed by client disconnect
        }
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        try {
          controller.close();
        } catch {
          // already closed
        }
        // 二十九收工 S6:可观测清理(防资源泄漏)。progress bus 订阅(redis 档内部 unsubscribe+quit)
        if (subscription) {
          void subscription
            .unsubscribe()
            .catch((e) => console.warn(`[sse-aigc] progress unsubscribe failed:`, e));
        }
      };

      // 1. 终态兜底(进入时):已终态推一条后关闭
      if (await pushTerminalIfDone(attemptId, attempt, send)) {
        close();
        return;
      }

      // 2. 仍在 QUEUED/RUNNING:订阅进度总线
      //   - redis 档:跨进程 pub/sub + 边界 Zod 校验(畸形 payload 在 bus 内 log+跳过,不冒泡)
      //   - in-process 档:同进程 EventEmitter(桌面单进程)
      //   投递的都是已校验的 typed 事件
      subscription = await getProgressBus().subscribe(attemptId, (event) => {
        send(event);
        if (event.type === 'success' || event.type === 'failed') {
          close();
        }
      });

      // ⚠️ audit 修 P1-2:订阅完成 SSE 端在 channel 上后,double-check DB 兜底丢消息
      //
      // 漏洞场景:① 客户端进入 SSE 时 DB 还是 RUNNING
      //          ② worker 几 ms 内 commit transaction(attempt SUCCESS)+ publish 'success'
      //          ③ SSE 才执行 subscribe → 来不及收到这条 publish → 永远卡 RUNNING
      //
      // 解法:subscribe 之后再查一次 DB,如果已终态就主动推一条(幂等,前端 hook 会 close)
      const recheck = await prisma.generationAttempt.findUnique({
        where: { id: attemptId },
        select: {
          status: true,
          outputMediaId: true,
          errorMsg: true,
          costCny: true,
        },
      });
      if (await pushTerminalIfDone(attemptId, recheck, send)) {
        close();
        return;
      }

      // 3. 立即推 'running' 让前端确认 SSE 已建立
      send({ type: 'running', attemptId });

      // 4. 30min 硬超时 + client abort 清理
      timeoutHandle = setTimeout(close, STREAM_MAX_MS);
      request.signal.addEventListener('abort', close);
    },
    cancel() {
      closed = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (subscription) void subscription.unsubscribe().catch(() => {});
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 防 nginx 缓冲
    },
  });
}
