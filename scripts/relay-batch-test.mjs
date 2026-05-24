#!/usr/bin/env node
/**
 * 中转站(Relay)批量 API 连接性测试
 *
 * 用途:对 moyu.info / 其他中转站的全量非视频模型做"能不能调通"端到端验证。
 * 适合在用户给了新 token 后跑一遍,知道哪些模型真活、哪些下架、哪些路由有问题。
 *
 * 与 scripts/relay-real-test.mjs 区别:
 *   - 那个脚本:1 个模型 + 完整业务链路(走 admin endpoint + script.analyze)
 *   - 这个脚本:107 个模型 + 直连中转站 HTTP(绕 admin 5/min rate limit)
 *
 * 跑法:
 *   RELAY_TOKEN=sk-xxx node scripts/relay-batch-test.mjs
 *
 * 可选 env:
 *   RELAY_BASE_URL=https://www.moyu.info/v1   # 默认 moyu
 *   RELAY_TEST_LIMIT=20                       # 0=全部 / N=随机抽 N 个
 *   RELAY_CONCURRENCY=5                       # 并发 worker 数(别打爆中转站)
 *   RELAY_TIMEOUT_MS=30000                    # 单请求 timeout
 *   RELAY_SKIP_IMAGE=1                        # 跳过 IMAGE 探活,只测 TEXT
 *
 * 测试策略:
 *   - TEXT:真调 /chat/completions,messages=[{role:user, content:'hi'}], max_tokens=1
 *     · 单次消耗:输入 ~3 token + 输出 1 token,按 ¥7.5/M 算单次约 ¥0.00003
 *     · 95 模型全跑总成本估计 < ¥0.01(忽略)
 *   - IMAGE:GET /models 看 modelId 是否在 list 中(不真生成,避免每张图扣钱)
 *   - VIDEO:不测(每次 ¥2+,且业务流程才合理触发)
 *
 * 安全:
 *   - 只读 process.env.RELAY_TOKEN,不接受参数 / 文件
 *   - 不在 stdout 打印 token 完整值,只显示后 4 位
 *   - 报告 CSV 写到 tmp/relay-batch-<ts>.csv(.gitignore 已 cover)
 *   - 跑完强烈提醒去中转站 revoke 此 token
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'packages', 'shared', 'data', 'relay-catalogs.json');

// ─── env 校验 ───────────────────────────────────────────────────
const TOKEN = process.env.RELAY_TOKEN;
if (!TOKEN || !TOKEN.startsWith('sk-')) {
  console.error('❌ RELAY_TOKEN env 未设置或格式不对(需 sk- 开头)');
  console.error('   跑法: RELAY_TOKEN=sk-xxx node scripts/relay-batch-test.mjs');
  process.exit(1);
}
const BASE_URL = (process.env.RELAY_BASE_URL || 'https://www.moyu.info/v1').replace(/\/+$/, '');
const LIMIT = Number.parseInt(process.env.RELAY_TEST_LIMIT || '0', 10);
const CONCURRENCY = Math.max(1, Math.min(20, Number.parseInt(process.env.RELAY_CONCURRENCY || '5', 10)));
const TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.RELAY_TIMEOUT_MS || '30000', 10));
const SKIP_IMAGE = process.env.RELAY_SKIP_IMAGE === '1';
const tokenMask = '••••' + TOKEN.slice(-4);

// ─── 加载 catalog ───────────────────────────────────────────────
const catalogFile = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
const moyu = catalogFile.moyu;
if (!moyu?.models) {
  console.error('❌ catalog 中找不到 moyu.models(预期 packages/shared/data/relay-catalogs.json)');
  process.exit(1);
}

const textModels = (moyu.models.TEXT || []).map((m) => ({ ...m, kind: 'TEXT' }));
const imageModels = SKIP_IMAGE ? [] : (moyu.models.IMAGE || []).map((m) => ({ ...m, kind: 'IMAGE' }));
const videoSkipped = (moyu.models.VIDEO || []).length;

let targets = [...textModels, ...imageModels];
const totalAvailable = targets.length;
if (LIMIT > 0 && targets.length > LIMIT) {
  // 随机抽样 LIMIT 个
  targets = [...targets].sort(() => Math.random() - 0.5).slice(0, LIMIT);
}

// ─── 打印头部 ───────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('🚀 moyu 中转站批量 API 测试');
console.log(`   token       : ${tokenMask}`);
console.log(`   base url    : ${BASE_URL}`);
console.log(`   目标        : ${targets.length} / ${totalAvailable}(TEXT=${textModels.length} IMAGE=${imageModels.length}${SKIP_IMAGE ? ' [skipped]' : ''})`);
console.log(`   VIDEO 跳过  : ${videoSkipped}(每次 ¥2+,业务流程触发更安全)`);
console.log(`   并发        : ${CONCURRENCY}`);
console.log(`   timeout     : ${TIMEOUT_MS}ms`);
console.log('═══════════════════════════════════════════════════════════════\n');

// ─── HTTP helper · 带 timeout 的 fetch ─────────────────────────
async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

// ─── TEXT 测试 · 真调 chat completions ─────────────────────────
async function testText(model) {
  const startedAt = Date.now();
  try {
    const { status, text } = await fetchWithTimeout(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    const latencyMs = Date.now() - startedAt;
    if (status >= 200 && status < 300) {
      let usage = null;
      try {
        const j = JSON.parse(text);
        usage = j.usage ?? null;
      } catch {
        /* not json */
      }
      return { ok: true, statusCode: status, latencyMs, usage };
    }
    let errMsg = '';
    try {
      const j = JSON.parse(text);
      errMsg = j?.error?.message ?? j?.message ?? text.slice(0, 120);
    } catch {
      errMsg = text.slice(0, 120);
    }
    return { ok: false, statusCode: status, latencyMs, error: errMsg };
  } catch (e) {
    return {
      ok: false,
      statusCode: 0,
      latencyMs: Date.now() - startedAt,
      error: e.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : e.message,
    };
  }
}

// ─── IMAGE 测试 · 仅 list /models 探活(不真生成图)─────────────
//
// /models 是 OpenAI 兼容的列表端点,大多数中转站都实现。我们只验:
//   - token 有效(401 / 403 → 凭证错)
//   - modelId 在 list 里(说明上架)
let imageModelsList = null;
async function ensureImageModelsList() {
  if (imageModelsList !== null) return imageModelsList;
  try {
    const { status, text } = await fetchWithTimeout(`${BASE_URL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (status === 200) {
      try {
        const j = JSON.parse(text);
        imageModelsList = (j.data ?? j.models ?? []).map((x) => x.id ?? x.model ?? '');
      } catch {
        imageModelsList = [];
      }
    } else {
      imageModelsList = []; // 列表拿不到,fallback 全部"未列出"
    }
  } catch {
    imageModelsList = [];
  }
  return imageModelsList;
}

async function testImage(model) {
  const startedAt = Date.now();
  try {
    const list = await ensureImageModelsList();
    const latencyMs = Date.now() - startedAt;
    if (list.length === 0) {
      return {
        ok: false,
        statusCode: 0,
        latencyMs,
        error: '/models 列表为空或拿不到(token 可能无效)',
      };
    }
    const found = list.includes(model.modelId);
    return {
      ok: found,
      statusCode: 200,
      latencyMs,
      note: found ? 'listed' : 'NOT in /models 列表',
      error: found ? undefined : 'NOT in /models 列表',
    };
  } catch (e) {
    return {
      ok: false,
      statusCode: 0,
      latencyMs: Date.now() - startedAt,
      error: e.message,
    };
  }
}

// ─── 并发 pool ─────────────────────────────────────────────────
async function pool(items, workerCount, fn) {
  const results = new Array(items.length);
  let next = 0;
  let completed = 0;
  const total = items.length;
  const workers = Array.from({ length: Math.min(workerCount, total) }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const r = await fn(items[i], i);
      results[i] = { ...items[i], ...r };
      completed++;
      const sym = r.ok ? '✅' : '❌';
      const pct = ((completed / total) * 100).toFixed(1).padStart(5);
      const lat = `${r.latencyMs}ms`.padStart(7);
      const codeStr = `${r.statusCode || 'ERR'}`.padStart(3);
      const idStr = items[i].modelId.padEnd(40);
      const tail = r.ok ? '' : ` · ${(r.error || '').slice(0, 70)}`;
      console.log(`  ${sym} [${String(completed).padStart(3)}/${total} ${pct}%] ${idStr} ${codeStr} ${lat}${tail}`);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── 跑 ────────────────────────────────────────────────────────
const t0 = Date.now();
const results = await pool(targets, CONCURRENCY, (m) => (m.kind === 'TEXT' ? testText(m) : testImage(m)));
const totalMs = Date.now() - t0;

// ─── 报告 ──────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('📊 测试报告');
console.log('═══════════════════════════════════════════════════════════════\n');

const okList = results.filter((r) => r.ok);
const failList = results.filter((r) => !r.ok);
console.log(`总耗时    : ${(totalMs / 1000).toFixed(1)}s`);
console.log(`成功      : ${okList.length} / ${results.length}(${((okList.length / results.length) * 100).toFixed(1)}%)`);
console.log(`失败      : ${failList.length}\n`);

if (failList.length > 0) {
  const byCode = {};
  for (const r of failList) {
    const key = r.statusCode === 0 ? 'timeout/network' : `HTTP ${r.statusCode}`;
    byCode[key] = byCode[key] || [];
    byCode[key].push(r);
  }
  console.log('失败分类:');
  for (const code of Object.keys(byCode).sort()) {
    const list = byCode[code];
    console.log(`  · ${code}: ${list.length}`);
    for (const r of list.slice(0, 8)) {
      console.log(`     · ${r.modelId} (${r.kind}) — ${(r.error || '').slice(0, 90)}`);
    }
    if (list.length > 8) console.log(`     · ... +${list.length - 8} more(详见 CSV)`);
  }
  console.log('');
}

if (okList.length > 0) {
  const lats = okList.map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (q) => lats[Math.min(lats.length - 1, Math.floor(lats.length * q))];
  console.log('latency (成功项):');
  console.log(`  · p50=${pct(0.5)}ms  p90=${pct(0.9)}ms  p99=${pct(0.99)}ms  min=${lats[0]}ms  max=${lats[lats.length - 1]}ms\n`);
}

// 按 vendor 分组
const byVendor = {};
for (const r of results) {
  const v = r.vendor || 'unknown';
  byVendor[v] = byVendor[v] || { ok: 0, fail: 0 };
  byVendor[v][r.ok ? 'ok' : 'fail'] += 1;
}
console.log('按 vendor 分组:');
const sorted = Object.entries(byVendor).sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail));
for (const [v, { ok, fail }] of sorted) {
  const total = ok + fail;
  const pct = ((ok / total) * 100).toFixed(0).padStart(3);
  const bar = '█'.repeat(Math.round((ok / total) * 20));
  const failTail = fail > 0 ? ` ❌×${fail}` : '';
  console.log(`  · ${v.padEnd(16)} ${String(ok).padStart(2)}/${String(total).padEnd(2)} (${pct}%) ${bar}${failTail}`);
}
console.log('');

// ─── 写 CSV ────────────────────────────────────────────────────
const tmpDir = path.join(ROOT, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const csvPath = path.join(tmpDir, `relay-batch-${ts}.csv`);
const csvRows = ['modelId,kind,vendor,group,ok,statusCode,latencyMs,promptTokens,completionTokens,error'];
for (const r of results) {
  const cells = [
    r.modelId,
    r.kind,
    r.vendor || '',
    r.group || '',
    r.ok ? '1' : '0',
    String(r.statusCode || 0),
    String(r.latencyMs),
    String(r.usage?.prompt_tokens ?? ''),
    String(r.usage?.completion_tokens ?? ''),
    `"${(r.error || r.note || '').replace(/"/g, '""').replace(/\n/g, ' ').slice(0, 200)}"`,
  ];
  csvRows.push(cells.join(','));
}
fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf-8');
console.log(`📄 CSV 报告: ${path.relative(ROOT, csvPath)}\n`);

console.log('🔒 安全提醒:');
console.log('  - 测试已结束,token 已不在内存中(进程将退出)');
console.log('  - 强烈建议去 moyu.info 后台 revoke 这个 token(用过的应 rotate)');
console.log('');

// 失败 > 一半 才返回非零(便于 CI / 重定向判断)
process.exit(failList.length > okList.length ? 1 : 0);
