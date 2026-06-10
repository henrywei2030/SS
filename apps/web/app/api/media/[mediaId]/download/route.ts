/**
 * 媒体下载路由(六八)— 同源 attachment 下载,真正弹"另存为"。
 *
 * 背景:原 UI 用跨域 `<a download>` 指 provider 直链 — 跨域时 download 属性失效,
 * 浏览器直接**导航**到 mp4 替换整页(桌面壳里没有返回键,死路)。改走本路由:
 * 同源 + Content-Disposition: attachment(中文文件名 RFC5987 编码),浏览器走下载框。
 *
 * 数据源:已缓存 → 对象存储流式转发;未缓存 → 拉 provider 直链转发(代理透传)。
 */
import { Readable } from 'node:stream';

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@ss/db';
import { getStorageAdapter } from '@ss/adapters/storage';

import { getSession } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { mediaId } = await params;
  const media = await prisma.mediaItem.findFirst({
    where: { id: mediaId, deletedAt: null },
    select: {
      filename: true,
      mimeType: true,
      storageKey: true,
      cdnUrl: true,
      projectId: true,
      scope: true,
    },
  });
  if (!media) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  // 项目访问权(对齐 assertProjectAccess:owner 或成员;公共库无 projectId 直接放行)
  if (media.projectId) {
    const ok = await prisma.project.findFirst({
      where: {
        id: media.projectId,
        deletedAt: null,
        OR: [{ ownerId: session.id }, { members: { some: { userId: session.id } } }],
      },
      select: { id: true },
    });
    if (!ok) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  const filename = media.filename || `${mediaId}.bin`;
  // RFC 5987:中文文件名编码,ASCII fallback 保底
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  const headers: Record<string, string> = {
    'Content-Disposition': disposition,
    'Content-Type': media.mimeType || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
  };

  // 已缓存/本地 → 对象存储流式转发
  if (
    !media.storageKey.startsWith('external://') &&
    !media.storageKey.startsWith('placeholder://')
  ) {
    const nodeStream = await getStorageAdapter().getObject(media.storageKey);
    const webStream = Readable.toWeb(
      nodeStream as Readable,
    ) as unknown as ReadableStream;
    return new Response(webStream, { headers });
  }
  // 未缓存 → 拉源转发(provider 直链可能已过期,给可读错误)
  const origin = media.cdnUrl ?? media.storageKey.slice('external://'.length);
  if (!origin.startsWith('http')) {
    return NextResponse.json({ error: '该媒体无可下载源' }, { status: 422 });
  }
  const upstream = await fetch(origin, { signal: AbortSignal.timeout(300_000) });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `源下载失败(HTTP ${upstream.status})— provider 直链可能已过期,请等缓存完成或重新生成` },
      { status: 502 },
    );
  }
  return new Response(upstream.body, { headers });
}
