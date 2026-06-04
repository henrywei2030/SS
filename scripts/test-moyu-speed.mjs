/** 四九收工诊断:测 moyu 各模型生成"一集剧本量"的真实耗时(隔离慢在哪) */
import { prisma } from '../packages/db/src/index.js';
import { decryptSecret } from '../packages/adapters/src/crypto.js';

const PROMPT =
  '写一段短剧剧本,约 1200 字,分 8 个分镜,每个分镜含【画面】和【声音】。题材:程序员获得读心术。';

async function timeModel(baseUrl, key, model) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 200_000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 2500 }),
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    const j = await res.json().catch(() => ({}));
    const outTok = j.usage?.completion_tokens ?? '?';
    const rate = typeof outTok === 'number' ? (outTok / (ms / 1000)).toFixed(1) : '?';
    return `HTTP ${res.status} · ${(ms / 1000).toFixed(1)}s · 输出 ${outTok} tok · ${rate} tok/s`;
  } catch (e) {
    return `✗ ${((Date.now() - t0) / 1000).toFixed(1)}s · ${e.name}`;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const moyu = await prisma.relayProvider.findUnique({ where: { name: 'moyu' } });
  const key = decryptSecret(moyu.apiKeyEnc);
  for (const m of ['gemini-3-flash-preview', 'claude-opus-4-6', 'claude-sonnet-4-6']) {
    process.stdout.write(`[${m}] `);
    console.log(await timeModel(moyu.apiUrl, key, m));
  }
}
main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
