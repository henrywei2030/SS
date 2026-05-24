#!/usr/bin/env node
/**
 * Admin Provider CRUD 集成测试
 *
 * 验证第 22 轮新增 admin.provider.create + delete mutation
 * 模拟 admin 后台"添加自定义 Provider"流程(4 类入口之一)
 *
 * 跑法: node scripts/test-admin-provider-crud.mjs
 */
const BASE = 'http://localhost:3000';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123!@#';

const cookieJar = new Map();
function cookieStr() {
  return Array.from(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}
function setCookieFromResponse(rawHeaders) {
  for (const c of rawHeaders) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: cookieStr() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  const setCookieRaw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
      ? [res.headers.get('set-cookie')]
      : [];
  if (setCookieRaw.length > 0) setCookieFromResponse(setCookieRaw);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  return { status: res.status, json, text };
}
const trpcMut = (path, input) => api(`/api/trpc/${path}`, { method: 'POST', body: { json: input } });
const trpcQuery = (path, input) =>
  api(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`);
const unwrap = (res) => res.json?.result?.data?.json ?? res.json?.error?.json ?? res.json;
const trpcError = (res) => res.json?.error?.json;

const TEST_PID = 'custom-test-poe-claude-' + Date.now();

(async () => {
  console.log(`🧪 Admin Provider CRUD 测试 (providerId=${TEST_PID})\n`);

  console.log('🔐 [1] admin login...');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { identifier: ADMIN_USER, password: ADMIN_PASS },
  });
  if (login.status !== 200) {
    console.error(`❌ ${login.text}`);
    process.exit(1);
  }
  console.log(`  ✅ OK\n`);

  console.log(`📦 [2] create — 模拟"添加 Poe 订阅 Provider"`);
  const create = await trpcMut('admin.provider.create', {
    providerId: TEST_PID,
    displayName: 'Test Poe Claude 3.7 (订阅)',
    kind: 'TEXT',
    apiUrl: 'https://api.poe.com/v1',
    unitPriceCny: 0, // 订阅制
    unitName: 'ktoken',
    maxConcurrent: 5,
    rateLimitRpm: 60,
    defaultParams: {
      protocol: 'openai-compat',
      defaultModel: 'claude-3-7-sonnet',
      source: 'subscription',
    },
  });
  const createErr = trpcError(create);
  if (create.status !== 200 || createErr) {
    console.error(`  ❌ create 失败: ${createErr?.message ?? create.text}`);
    process.exit(1);
  }
  const created = unwrap(create);
  console.log(`  ✅ 创建 OK id=${created.id?.slice(-8)} isActive=${created.isActive}\n`);

  console.log(`📋 [3] list — verify 出现在清单`);
  const list = await trpcQuery('admin.provider.list');
  const items = unwrap(list);
  const found = Array.isArray(items) ? items.find((p) => p.providerId === TEST_PID) : null;
  if (!found) {
    console.error(`  ❌ list 没找到 ${TEST_PID}`);
    process.exit(1);
  }
  console.log(`  ✅ 找到 displayName="${found.displayName}" apiKeyConfigured=${found.apiKeyConfigured}\n`);

  console.log(`🔁 [4] create 重复 providerId — 应被拒(CONFLICT)`);
  const dup = await trpcMut('admin.provider.create', {
    providerId: TEST_PID,
    displayName: 'duplicate',
    kind: 'TEXT',
    apiUrl: 'https://api.poe.com/v1',
    unitPriceCny: 0,
    unitName: 'ktoken',
    defaultParams: { protocol: 'openai-compat', defaultModel: 'x', source: 'subscription' },
  });
  const dupErr = trpcError(dup);
  if (dupErr?.message && /已存在/i.test(dupErr.message)) {
    console.log(`  ✅ 防重生效: ${dupErr.message.slice(0, 60)}\n`);
  } else {
    console.error(`  ❌ 防重没生效`, dupErr);
    process.exit(1);
  }

  console.log(`🚫 [5] create 非法 providerId 格式 — zod 防御`);
  const bad = await trpcMut('admin.provider.create', {
    providerId: 'Invalid_Caps_ID', // 大写 + 下划线
    displayName: 'bad',
    kind: 'TEXT',
    apiUrl: 'https://api.poe.com/v1',
    unitPriceCny: 0,
    unitName: 'ktoken',
    defaultParams: {},
  });
  if (trpcError(bad)?.data?.zodIssues) {
    console.log(`  ✅ zod 拒非法 providerId\n`);
  } else {
    console.error(`  ❌ zod 没拒`, bad);
  }

  console.log(`🗑️  [6] delete — 删自创的(无 apiKey,应过)`);
  const del = await trpcMut('admin.provider.delete', { providerId: TEST_PID, confirmDelete: true });
  if (del.status !== 200 || trpcError(del)) {
    console.error(`  ❌ delete 失败: ${trpcError(del)?.message ?? del.text}`);
    process.exit(1);
  }
  console.log(`  ✅ delete OK\n`);

  console.log(`🛡️  [7] delete 带 apiKey 的 — 应拒(PRECONDITION_FAILED)`);
  // 再创一个 + 设 key + 试删 → 应拒
  const create2 = await trpcMut('admin.provider.create', {
    providerId: TEST_PID + '-2',
    displayName: 'protected',
    kind: 'TEXT',
    apiUrl: 'https://api.poe.com/v1',
    unitPriceCny: 0,
    unitName: 'ktoken',
    defaultParams: { protocol: 'openai-compat', defaultModel: 'x', source: 'subscription' },
  });
  if (create2.status !== 200) {
    console.error(`  ❌ 二次 create 失败`, create2.text);
    process.exit(1);
  }
  await trpcMut('admin.provider.setApiKey', { providerId: TEST_PID + '-2', apiKey: 'fake-test-key-1234' });
  const delProtected = await trpcMut('admin.provider.delete', {
    providerId: TEST_PID + '-2',
    confirmDelete: true,
  });
  if (trpcError(delProtected)?.message && /apiKey|clearApiKey/i.test(trpcError(delProtected).message)) {
    console.log(`  ✅ 拒删带 key 的: ${trpcError(delProtected).message.slice(0, 80)}`);
  } else {
    console.error(`  ❌ 应拒但通过了`);
  }
  // cleanup
  await trpcMut('admin.provider.clearApiKey', { providerId: TEST_PID + '-2' });
  await trpcMut('admin.provider.delete', { providerId: TEST_PID + '-2', confirmDelete: true });
  console.log(`  ✅ cleanup OK\n`);

  console.log('🎉 Admin Provider CRUD 全部通过');
})().catch((e) => {
  console.error(`💥 ${e.message}`);
  console.error(e);
  process.exit(2);
});
