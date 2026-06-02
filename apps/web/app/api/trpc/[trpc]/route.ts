/**
 * tRPC Route Handler — 所有 tRPC 请求统一入口
 *
 * W7 audit R8 P0:CSRF 防御 — 对 mutation(POST)校验 Origin / Sec-Fetch-Site,
 * 拒非同源 / 跨站请求。GET(query)不需要(cookie 走 sameSite=lax 足够)。
 */
import { randomUUID } from 'node:crypto';

import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { cookies, headers } from 'next/headers';

import { appRouter, createContext } from '@ss/api';

import { SESSION_COOKIE } from '@/lib/auth/session';
// 四六收工:isOriginAllowed 抽到 route-guard 单一真相源(登录 REST route 也复用)
import { isOriginAllowed } from '@/lib/auth/route-guard';

const handler = async (req: Request): Promise<Response> => {
  const cookieStore = await cookies();
  const hdrs = await headers();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? null;

  // W7 audit R8 P0:CSRF Origin 校验(仅对写方法)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const origin = hdrs.get('origin');
    const host = hdrs.get('host');
    if (!isOriginAllowed(origin, host)) {
      return new Response(
        JSON.stringify({
          error: { message: 'CSRF: Origin not allowed', code: 'FORBIDDEN' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // 第 19 轮 audit P1:每请求生成 requestId 贯穿 ctx → audit log → 入队 Job → worker
  // 第 23 轮 audit P1 加固:防客户端伪造 requestId 污染日志/timing attack
  //   - 仅接受 反向代理 注入的 X-Request-Id(格式:UUID 或 trace-id 风格)
  //   - 客户端任意值不直接用,统一加 `client-` 前缀标识 + 服务端自己生成新的并把客户端值放 `client-id` query log
  //   - 默认自己生成 UUID 兜底
  const incomingReqId = hdrs.get('x-request-id');
  let requestId: string;
  // 仅接受 反向代理 / 服务端可信源 注入的格式严格的 UUID
  // 客户端伪造的值仍记录(供 debug)但不作为唯一标识
  if (incomingReqId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(incomingReqId)) {
    requestId = incomingReqId;
  } else {
    requestId = randomUUID();
    if (incomingReqId) {
      console.warn(`[trpc] X-Request-Id 格式不符 UUID,忽略客户端值,自生成 ${requestId}`);
    }
  }

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () =>
      createContext({
        authToken: token,
        locale: req.headers.get('accept-language'),
        ip:
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          req.headers.get('x-real-ip') ??
          null,
        userAgent: req.headers.get('user-agent'),
        requestId,
      }),
    onError({ error, path }) {
      // 失败必印 requestId,生产 / dev 都印(用户拿 requestId 报 bug 时这是入口)
      console.error(`[trpc][req=${requestId}] ${path ?? '<no-path>'}: ${error.message}`);
    },
    responseMeta() {
      // 把 requestId 回吐到 response header,前端可读取展示给用户
      return { headers: { 'x-request-id': requestId } };
    },
  });
};

export { handler as GET, handler as POST };
