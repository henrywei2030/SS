#!/usr/bin/env node
// 桌面打包回归验证(可跨机):用【打包后的资源】跑完整启动链 —— bootstrap(内嵌 PG initdb/迁移/seed)
//   → 起 standalone web → 真实 HTTP 抓主页,证明"装完能进主界面、不卡 splash",然后干净停 web + pg 退出。
//
// 用法(需先 `node scripts/desktop-pack.mjs` 产出 resources):
//   SS_DESKTOP_PACKAGED=1 SS_DESKTOP_DATA_DIR=<临时目录> SS_DESKTOP_PG_PORT=54333 PORT=47906 \
//   SS_DESKTOP_MIGRATIONS_DIR=<...>/resources/db/migrations SS_DESKTOP_SEED_JS=<...>/resources/db/seed.mjs \
//   node scripts/verify-desktop-flow.mjs
// (Windows PowerShell 用 $env:NAME='...' 逐个设)。退出码 0 = PASS。
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(ROOT, 'apps/desktop/src-tauri/resources');
const PORT = process.env.PORT || '47906';
const HOST = 'localhost';

const { bootstrapDesktop } = await import(
  pathToFileURL(join(RES, 'runtime/desktop-bootstrap.mjs')).href
);

const waitPort = (port, host, timeoutMs) =>
  new Promise((res) => {
    const start = Date.now();
    const tick = () => {
      const s = connect({ host, port: Number(port) }, () => {
        s.destroy();
        res(true);
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) res(false);
        else setTimeout(tick, 500);
      });
    };
    tick();
  });

console.log('[verify] === bootstrap(initdb/migrate/seed)… ===');
const { env, stop } = await bootstrapDesktop({});
console.log('[verify] bootstrap 完成,起 standalone web…');
const web = spawn(process.execPath, ['server.js'], {
  cwd: join(RES, 'web', 'apps', 'web'),
  env: { ...env, PORT, HOSTNAME: HOST },
  stdio: 'inherit',
});

const up = await waitPort(PORT, HOST, 90000);
console.log(`[verify] web :${PORT} 监听: ${up}`);

let ok = false;
if (up) {
  try {
    let res = await fetch(`http://${HOST}:${PORT}/`, { redirect: 'manual' });
    let chain = `GET / → ${res.status}`;
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && res.headers.get('location') && hops < 5) {
      const loc = new URL(res.headers.get('location'), `http://${HOST}:${PORT}/`);
      res = await fetch(loc, { redirect: 'manual' });
      chain += ` → ${loc.pathname} ${res.status}`;
      hops++;
    }
    const body = await res.text();
    const isHtml = body.includes('<!DOCTYPE') || body.includes('<html');
    console.log(`[verify] ${chain}`);
    console.log(`[verify] 终页 ${res.status} · HTML=${isHtml} · ${body.length} bytes`);
    ok = res.status === 200 && isHtml && body.length > 500;
  } catch (e) {
    console.log(`[verify] fetch 错误: ${e.message}`);
  }
}

console.log(`[verify] ===== ${ok ? 'PASS — web 返回真实主界面(非 splash)' : 'FAIL'} =====`);
try {
  web.kill();
} catch {
  /* ignore */
}
try {
  await stop();
} catch {
  /* ignore */
}
setTimeout(() => process.exit(ok ? 0 : 2), 1500);
