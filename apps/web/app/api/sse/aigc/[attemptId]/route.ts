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
import { createRedisSubscriber } from '@ss/queue/redis';
import { verifyStreamToken } from '@ss/queue/sse-token';
import {
  videoGenChannel,
  VideoGenProgressEventSchema,
  type VideoGenProgressEvent,
} from '@ss/queue/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STREAM_MAX_MS = 30 * 60_000; // 30 分钟硬上限

function sseFormat(event: VideoGenProgressEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
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

  const subscriber = createRedisSubscriber(`sse:${attemptId}`);
  const channel = videoGenChannel(attemptId);
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
        void subscriber.unsubscribe(channel).catch(() => {});
        void subscriber.quit().catch(() => {});
      };

      // 1. 终态兜底
      if (attempt.status === 'SUCCESS') {
        // 第 2 轮 audit P0-2:MediaItem 已被软删/不存在时,不能推空 videoUrl(前端 UI 显示空 <video>)
        if (!attempt.outputMediaId) {
          send({
            type: 'failed',
            attemptId,
            errorMsg: 'success_but_no_media: attempt.outputMediaId 为空',
            retryable: false,
          });
          close();
          return;
        }
        const m = await prisma.mediaItem.findFirst({
          where: { id: attempt.outputMediaId, deletedAt: null },
          select: { id: true, cdnUrl: true, meta: true },
        });
        if (!m || !m.cdnUrl) {
          send({
            type: 'failed',
            attemptId,
            errorMsg: 'media_deleted_or_missing: MediaItem 已被删除或缺 cdnUrl',
            retryable: false,
          });
          close();
          return;
        }
        const meta = (m.meta as Record<string, unknown> | null) ?? {};
        const thumbnailUrl =
          typeof meta.thumbnailUrl === 'string' ? meta.thumbnailUrl : undefined;
        send({
          type: 'success',
          attemptId,
          mediaId: m.id,
          videoUrl: m.cdnUrl,
          thumbnailUrl,
          costCny: Number(attempt.costCny ?? 0),
        });
        close();
        return;
      }
      if (attempt.status === 'FAILED') {
        send({
          type: 'failed',
          attemptId,
          errorMsg: attempt.errorMsg ?? 'unknown',
          retryable: false,
        });
        close();
        return;
      }

      // 2. 仍在 QUEUED/RUNNING:订阅 Redis
      await subscriber.subscribe(channel);
      subscriber.on('message', (ch, msg) => {
        if (ch !== channel) return;
        try {
          // r10 audit:用 Zod runtime validate · JSON.parse + as cast 在协议升级 / 异常 publish 时
          //   payload 不符合类型仍 cast 成功 → 推到前端崩 UI。改成 schema.parse 失败直接 log + 跳过
          const parsed = VideoGenProgressEventSchema.parse(JSON.parse(msg));
          send(parsed);
          if (parsed.type === 'success' || parsed.type === 'failed') {
            close();
          }
        } catch (err) {
          console.error(`[sse:${attemptId}] parse/validate message failed:`, err instanceof Error ? err.message : err);
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
      if (recheck?.status === 'SUCCESS') {
        // 第 2 轮 audit P0-2:double-check 分支同样防空 media 推送
        if (!recheck.outputMediaId) {
          send({
            type: 'failed',
            attemptId,
            errorMsg: 'success_but_no_media: attempt.outputMediaId 为空',
            retryable: false,
          });
          close();
          return;
        }
        const m = await prisma.mediaItem.findFirst({
          where: { id: recheck.outputMediaId, deletedAt: null },
          select: { id: true, cdnUrl: true, meta: true },
        });
        if (!m || !m.cdnUrl) {
          send({
            type: 'failed',
            attemptId,
            errorMsg: 'media_deleted_or_missing: MediaItem 已被删除或缺 cdnUrl',
            retryable: false,
          });
          close();
          return;
        }
        const meta = (m.meta as Record<string, unknown> | null) ?? {};
        const thumbnailUrl =
          typeof meta.thumbnailUrl === 'string' ? meta.thumbnailUrl : undefined;
        send({
          type: 'success',
          attemptId,
          mediaId: m.id,
          videoUrl: m.cdnUrl,
          thumbnailUrl,
          costCny: Number(recheck.costCny ?? 0),
        });
        close();
        return;
      }
      if (recheck?.status === 'FAILED') {
        send({
          type: 'failed',
          attemptId,
          errorMsg: recheck.errorMsg ?? 'unknown',
          retryable: false,
        });
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
      void subscriber.unsubscribe(channel).catch(() => {});
      void subscriber.quit().catch(() => {});
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
