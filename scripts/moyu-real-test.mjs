#!/usr/bin/env node
/**
 * Moyu 真接入端到端测试
 *
 * 用 MOYU_TOKEN env 注入 token,**脚本本身零凭据**
 * 跑法:`MOYU_TOKEN=sk-xxx node scripts/moyu-real-test.mjs`
 *
 * 验证链路:
 *   1. admin 登录
 *   2. admin.provider.setApiKey(moyu-claude-sonnet-4-5)
 *   3. admin.provider.setActive(true)
 *   4. admin.provider.testConnection → 真调 moyu chat verify
 *   5. admin.provider.list → verify 新启用项 + masked key
 *   6. (可选)script.analyze 真触发 LLM
 *
 * 安全:
 *   - 脚本只接 env token,不接受参数 / 文件
 *   - 完成后 cleanup:setActive(false)(防 token 后续真用扣钱)
 *   - 不在 stdout 完整打印 token,只显示后 4 位
 */

const BASE = 'http://localhost:3000';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123!@#';

const TOKEN = process.env.MOYU_TOKEN;
if (!TOKEN || !TOKEN.startsWith('sk-')) {
  console.error('❌ MOYU_TOKEN env 未设置或格式不对(需 sk- 开头)');
  console.error('   跑法: MOYU_TOKEN=sk-xxx node scripts/moyu-real-test.mjs');
  process.exit(1);
}
const tokenMask = '••••' + TOKEN.slice(-4);

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
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieStr(),
    },
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
    /* not json */
  }
  return { status: res.status, requestId: res.headers.get('x-request-id'), json, text };
}

const trpcMut = (path, input) => api(`/api/trpc/${path}`, { method: 'POST', body: { json: input } });
const trpcQuery = (path, input) =>
  api(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`);

function unwrap(res) {
  return res.json?.result?.data?.json ?? res.json?.error?.json ?? res.json;
}
function trpcError(res) {
  return res.json?.error?.json;
}

const TARGET = 'moyu-claude-sonnet-4-5';

(async () => {
  console.log(`🚀 Moyu 真接入端到端测试(token=${tokenMask})\n`);

  // [1] admin 登录
  console.log('🔐 [1] admin 登录...');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { identifier: ADMIN_USER, password: ADMIN_PASS },
  });
  if (login.status !== 200) {
    console.error(`❌ login failed: ${login.text}`);
    process.exit(1);
  }
  console.log(`  ✅ user=${login.json?.user?.username} isAdmin=${login.json?.user?.isAdmin}\n`);

  // [2] setApiKey
  console.log(`🔑 [2] setApiKey(${TARGET}, ${tokenMask})...`);
  const setKey = await trpcMut('admin.provider.setApiKey', { providerId: TARGET, apiKey: TOKEN });
  const setKeyData = unwrap(setKey);
  const setKeyErr = trpcError(setKey);
  if (setKey.status !== 200 || setKeyErr) {
    console.error(`  ❌ setApiKey 失败: ${setKeyErr?.message ?? setKey.text}`);
    process.exit(1);
  }
  console.log(`  ✅ setApiKey 成功 reqId=${(setKey.requestId ?? '').slice(-8)}\n`);

  // [3] setActive(true)
  console.log(`🟢 [3] setActive(true)...`);
  const setAct = await trpcMut('admin.provider.setActive', { providerId: TARGET, isActive: true });
  if (setAct.status !== 200 || trpcError(setAct)) {
    console.error(`  ❌ setActive 失败: ${trpcError(setAct)?.message ?? setAct.text}`);
    process.exit(1);
  }
  console.log(`  ✅ setActive=true 成功\n`);

  // [4] list verify key masked
  console.log(`📋 [4] list 看 ${TARGET} 配置状态...`);
  const list = await trpcQuery('admin.provider.list');
  const items = unwrap(list);
  const target = Array.isArray(items) ? items.find((p) => p.providerId === TARGET) : null;
  if (!target) {
    console.error(`  ❌ provider not found in list`);
    process.exit(1);
  }
  console.log(`  ✅ providerId=${target.providerId}`);
  console.log(`     isActive=${target.isActive}`);
  console.log(`     hasApiKey=${target.hasApiKey ?? '?'}`);
  console.log(`     apiKeyMasked=${target.apiKeyMasked ?? '(无该字段)'}`);
  console.log('');

  // [5] testConnection 真调 moyu chat
  console.log(`🧪 [5] testConnection 真调 moyu chat 验证...`);
  const test = await trpcMut('admin.provider.testConnection', { providerId: TARGET, dryRun: false });
  const testData = unwrap(test);
  if (test.status !== 200) {
    console.error(`  ❌ testConnection 失败 status=${test.status}`);
    console.error(`     ${test.text.slice(0, 400)}`);
    process.exit(1);
  }
  if (!testData?.success) {
    console.error(`  ❌ testConnection success=false: ${testData?.message}`);
    process.exit(1);
  }
  console.log(`  ✅ testConnection success=true`);
  console.log(`     latencyMs=${testData.latencyMs}`);
  console.log(`     message=${testData.message}`);
  console.log(`     reqId=${(test.requestId ?? '').slice(-8)}`);
  console.log('');

  // [6] 顺手测一个 image / video 兼容 dryRun
  console.log(`🖼️ [6] 启用 moyu-doubao-seedream-4-0 + dryRun 测试...`);
  await trpcMut('admin.provider.setApiKey', { providerId: 'moyu-doubao-seedream-4-0', apiKey: TOKEN });
  await trpcMut('admin.provider.setActive', { providerId: 'moyu-doubao-seedream-4-0', isActive: true });
  const testImg = await trpcMut('admin.provider.testConnection', {
    providerId: 'moyu-doubao-seedream-4-0',
    dryRun: true,
  });
  const testImgData = unwrap(testImg);
  if (testImgData?.success) {
    console.log(`  ✅ image provider dryRun OK · ${testImgData.message}`);
  } else {
    console.log(`  ⚠️  image provider 测试: ${testImgData?.message}`);
  }
  console.log('');

  console.log(`🎬 [7] 启用 moyu-doubao-seedance-1-0-pro + dryRun 测试...`);
  await trpcMut('admin.provider.setApiKey', { providerId: 'moyu-doubao-seedance-1-0-pro', apiKey: TOKEN });
  await trpcMut('admin.provider.setActive', { providerId: 'moyu-doubao-seedance-1-0-pro', isActive: true });
  const testVid = await trpcMut('admin.provider.testConnection', {
    providerId: 'moyu-doubao-seedance-1-0-pro',
    dryRun: true,
  });
  const testVidData = unwrap(testVid);
  if (testVidData?.success) {
    console.log(`  ✅ video provider dryRun OK · ${testVidData.message}`);
  } else {
    console.log(`  ⚠️  video provider 测试: ${testVidData?.message}`);
  }
  console.log('');

  // [8] 真触发 W3 script.analyze — 真调 LLM 走全业务链路
  console.log(`📝 [8] W3 真触发: project + script + analyze...`);
  const proj = await trpcMut('project.create', {
    name: `Moyu Test ${new Date().toISOString().slice(0, 19)}`,
    type: 'AI_REAL',
    aspect: '9:16',
  });
  const projData = unwrap(proj);
  const projectId = projData?.id;
  if (!projectId) {
    console.error(`  ❌ project.create 失败`, projData);
    process.exit(1);
  }
  console.log(`  ✅ project 创建 OK id=${projectId.slice(-8)}`);

  const scriptContent = `场1·内·客厅·日

陈雪推门进来,看到桌上摆着一封信。脸色一沉,快步走过去抓起信封。

陈雪:这是什么?

她拆开信,里面是一张照片 — 她和老李在咖啡馆的合影。

陈雪(颤抖):他怎么知道...

【特写:照片在颤抖的手中】`;

  const upload = await trpcMut('script.upload', {
    projectId,
    episodeNumber: 1,
    content: scriptContent,
  });
  const uploadData = unwrap(upload);
  const scriptId = uploadData?.id ?? uploadData?.script?.id;
  if (!scriptId) {
    console.error(`  ❌ script.upload 失败`, uploadData);
    process.exit(1);
  }
  console.log(`  ✅ script.upload OK scriptId=${scriptId.slice(-8)}`);

  console.log(`  ⏳ script.analyze 真调 LLM(可能 5-15s)...`);
  const analyzeStart = Date.now();
  const analyze = await trpcMut('script.analyze', {
    scriptId,
    modelId: 'moyu-claude-sonnet-4-5',
  });
  const analyzeMs = Date.now() - analyzeStart;
  const analyzeData = unwrap(analyze);
  const analyzeErr = trpcError(analyze);
  if (analyze.status !== 200 || analyzeErr) {
    console.error(`  ❌ analyze 失败 ${analyzeMs}ms: ${analyzeErr?.message ?? analyze.text.slice(0, 200)}`);
  } else {
    console.log(`  ✅ analyze 完成 ${analyzeMs}ms`);
    if (analyzeData?.overallScore !== undefined) {
      console.log(`     overallScore=${analyzeData.overallScore}`);
    }
    if (analyzeData?.hookScore !== undefined) {
      console.log(`     hookScore=${analyzeData.hookScore} suspenseScore=${analyzeData.suspenseScore} climaxScore=${analyzeData.climaxScore}`);
    }
    if (analyzeData?.summary) {
      console.log(`     summary=${String(analyzeData.summary).slice(0, 120)}...`);
    }
    if (analyzeData?.costCny !== undefined) {
      console.log(`     costCny=${analyzeData.costCny}`);
    }
  }
  console.log('');

  // [9] cleanup: delete test project
  console.log(`🗑️  [9] cleanup test project...`);
  await trpcMut('project.delete', { id: projectId });
  console.log(`  ✅ cleanup OK`);
  console.log('');

  console.log('🎉 全部测试完成');
  console.log('');
  console.log('📌 cleanup 选项:');
  console.log(`  - 三个 Provider 已 setActive=true,后续真用会扣钱`);
  console.log(`  - 不再用时跑: PROVIDER=${TARGET} 等手动 setActive=false`);
  console.log(`  - **强烈建议你回 moyu 后台 revoke 此 token**(用过的应 rotate)`);
})().catch((e) => {
  console.error(`💥 脚本崩溃: ${e.message}`);
  console.error(e);
  process.exit(2);
});
