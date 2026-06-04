/** 四九收工诊断:测 moyu 各模型在 response_format=json_object 下是否返回空(storyboard "未返回 JSON" 根因) */
import { prisma } from '../packages/db/src/index.js';
import { decryptSecret } from '../packages/adapters/src/crypto.js';

async function call(baseUrl, key, model, jsonMode) {
  const body = {
    model,
    messages: [{ role: 'user', content: '输出一个 JSON 对象:{"shots":[{"desc":"一个镜头"}]},只输出 JSON。' }],
    max_tokens: 500,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
    const j = await res.json();
    const content = j.choices?.[0]?.message?.content ?? '';
    const outTok = j.usage?.completion_tokens ?? '?';
    const finish = j.choices?.[0]?.finish_reason ?? '?';
    return `HTTP ${res.status} · ${((Date.now() - t0) / 1000).toFixed(1)}s · out ${outTok}tok · finish=${finish} · content[${content.length}]: ${content.slice(0, 80).replace(/\n/g, ' ')}`;
  } catch (e) {
    return `✗ ${e.name}: ${e.message}`;
  }
}

async function main() {
  const moyu = await prisma.relayProvider.findUnique({ where: { name: 'moyu' } });
  const key = decryptSecret(moyu.apiKeyEnc);
  for (const m of ['claude-sonnet-4-6', 'claude-opus-4-6', 'gemini-3-flash-preview']) {
    console.log(`\n=== ${m} ===`);
    console.log(`  无 response_format : ${await call(moyu.apiUrl, key, m, false)}`);
    console.log(`  response_format=json: ${await call(moyu.apiUrl, key, m, true)}`);
  }
}
main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
