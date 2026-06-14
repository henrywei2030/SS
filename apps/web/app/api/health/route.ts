/**
 * 公开健康检查端点 — K8s / Load Balancer / Docker healthcheck 用
 *
 * r10 audit:此前只有 admin.health(adminProcedure 需登录),
 *   生产部署的 orchestrator(K8s liveness probe / Nginx upstream check / Docker HEALTHCHECK)
 *   无法通过 admin 接口探活。本端点无鉴权,仅返 minimal { ok } + 基本依赖检查。
 *
 * 设计:
 *   - 不查 DB / Redis(避免探活每秒数次打爆下游)
 *   - 只返 process uptime + version
 *   - cache-control no-store,防 CDN/反代缓存假活
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 七二第十波:fallback 跟随 app 版本(v0.2.0)。desktop standalone 走 `node server.js`、
//   无 npm_package_version env → 靠此 fallback 报正确版本,否则 /api/health 误报旧版。
const VERSION = process.env.npm_package_version ?? '0.2.0';
const START_AT = Date.now();

export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      service: 'starsalign-web',
      version: VERSION,
      uptimeSec: Math.floor((Date.now() - START_AT) / 1000),
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}

/** HEAD 探活(更轻量,K8s livenessProbe.httpGet 也支持 HEAD) */
export function HEAD(): Response {
  return new Response(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
