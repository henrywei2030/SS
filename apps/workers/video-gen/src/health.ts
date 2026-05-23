/**
 * Health Check HTTP Server — Docker healthcheck / K8s readinessProbe
 *
 * ADR-25 M11:fynt realtime 有 /health 但 worker 没有,我们补上。
 *   GET /health → { ok: true, workerId, uptimeMs }
 *
 * 端口可通过 WORKER_HEALTH_PORT env 配,默认 9200(避开 web 3000)。
 */
import http from 'node:http';

const PORT = Number(process.env.WORKER_HEALTH_PORT ?? '9200');

let server: http.Server | undefined;
let startedAt: Date | undefined;

export function startHealthServer(ctx: { workerId: string }): void {
  startedAt = new Date();
  server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const body = {
        ok: true,
        workerId: ctx.workerId,
        uptimeMs: startedAt ? Date.now() - startedAt.getTime() : 0,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(PORT, () => {
    console.log(`[${ctx.workerId}] health server listening on :${PORT}/health`);
  });
}

export async function stopHealthServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server!.close(() => resolve());
  });
  server = undefined;
}
