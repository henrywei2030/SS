/**
 * 一次性诊断(四九收工)— 直接用 moyu API 测各模型名是否真能返回。
 * 隔离"系统链路问题"vs"moyu 不提供该模型名"。
 *
 * 用法:cd packages/db && pnpm exec tsx --env-file=../../.env.local ../../scripts/test-moyu-models.mjs
 */
import { prisma } from '../packages/db/src/index.js';
import { decryptSecret } from '../packages/adapters/src/crypto.js';

const MODELS = [
  'claude-opus-4-6', // 控制组:moyu 后台已证实可用
  'claude-sonnet-4-6', // 怀疑对象:catalog 有但 moyu 后台无记录
  'claude-sonnet-4-5-20250929', // 变体:带日期版
  'claude-sonnet-4-6-20250930', // 变体:猜测的带日期版
  'gemini-3-flash-preview', // 对照:便宜且 moyu 后台已证实可用
];

async function testModel(baseUrl, key, model) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000); // 30s 超时
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回一个字:好' }],
        max_tokens: 20,
      }),
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    let snippet = text.slice(0, 160).replace(/\n/g, ' ');
    return `HTTP ${res.status} · ${ms}ms · ${snippet}`;
  } catch (e) {
    const ms = Date.now() - t0;
    return `✗ ${ms}ms · ${e.name}: ${e.message}`;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const moyu = await prisma.relayProvider.findUnique({ where: { name: 'moyu' } });
  if (!moyu?.apiKeyEnc) throw new Error('moyu 中转站无 key');
  const key = decryptSecret(moyu.apiKeyEnc);
  console.log(`moyu baseUrl: ${moyu.apiUrl} · key 末4位: ...${key.slice(-4)}\n`);

  for (const m of MODELS) {
    process.stdout.write(`[${m}] `);
    const r = await testModel(moyu.apiUrl, key, m);
    console.log(r);
  }
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
