/**
 * 三十六收工 P0 调试:Sonnet 4.6 + Gemini 3 Flash via moyu 返 JSON 失败原因诊断
 *
 * 用户报告:storyboard.generateForEpisode 用 Sonnet 4.6 一直返 markdown,
 *   切 Haiku 4.5 才能产 JSON。需深究 Sonnet 4.6 + Gemini 3 Flash 的真行为。
 *
 * 本脚本:解密 moyu API key + 直接 curl 测多模型多参数组合,
 *   print raw content,确认哪个 (model × params) 组合能稳定出 JSON。
 *
 * 用法:pnpm exec tsx scripts/debug-moyu-sonnet-vs-gemini.mjs
 */
// 用 Node 24 --env-file=.env.local 跑(无需 dotenv 依赖)
// 用相对路径 import workspace 源(脚本不在 workspace 包内)
import { prisma } from '../packages/db/src/index.ts';
import { decryptSecret } from '../packages/adapters/src/crypto.ts';

const relay = await prisma.relayProvider.findFirst({ where: { name: 'moyu' } });
if (!relay?.apiKeyEnc) {
  console.error('no moyu key');
  process.exit(1);
}
const apiKey = decryptSecret(relay.apiKeyEnc);
console.log('apiUrl:', relay.apiUrl);
console.log('apiKey prefix:', apiKey.slice(0, 8) + '...\n');

const SCENE_SHORT = `场景:第1集场1。陆衍在陌生房间醒来,看到墙上的规则。
对白:陆衍(内心OS):"心跳平稳,没有痛觉。这里不是医院,也不是我家。"`;

const SYSTEM_PROMPT = `你是分镜师。任务:把场景拆 2-3 个分镜,以严格 JSON 输出。

输出 schema:
{"shots":[{"index":1,"framing":"特写","angle":"平视 0°","movement":"固定","lighting":"自然光","content":"<30 字>","durationS":3,"priority":"B","prompt":"<100-150 字>"}]}

【强制规则】
1. 直接输出 JSON,从 { 开始,以 } 结尾
2. 禁止 markdown / 解释 / 代码块 / 任何 JSON 之外字符
3. 第一个字符必须是 {`;

async function testCombo(label, modelId, opts = {}, systemOverride) {
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: systemOverride ?? SYSTEM_PROMPT },
      { role: 'user', content: SCENE_SHORT },
    ],
    max_tokens: 2048,
    temperature: 0.3,
    ...opts,
  };
  const start = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST: ${label}`);
  console.log(`model=${modelId} · params=${JSON.stringify(opts)}`);
  try {
    const resp = await fetch(`${relay.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    const ms = Date.now() - start;
    if (resp.status !== 200) {
      console.log(`  HTTP ${resp.status} (${ms}ms): ${text.slice(0, 300)}`);
      return;
    }
    const json = JSON.parse(text);
    const content = json.choices?.[0]?.message?.content ?? '';
    const inT = json.usage?.prompt_tokens, outT = json.usage?.completion_tokens;
    console.log(`  ✓ HTTP 200 (${ms}ms) · tokens in/out: ${inT}/${outT}`);
    console.log(`  content first 300 chars:\n  ┌${'─'.repeat(60)}`);
    console.log('  │ ' + content.slice(0, 300).replace(/\n/g, '\n  │ '));
    console.log(`  └${'─'.repeat(60)}`);
    console.log(`  starts with: ${JSON.stringify(content.slice(0, 8))}`);

    // 解析
    let parsed = null;
    try {
      parsed = JSON.parse(content);
      console.log(`  ✅ pure JSON OK · shots=${parsed.shots?.length ?? '?'}`);
    } catch {
      const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenced) {
        try {
          parsed = JSON.parse(fenced[1]);
          console.log('  🟡 markdown fenced block OK · shots=' + (parsed.shots?.length ?? '?'));
        } catch {
          console.log('  ❌ fenced fail too');
        }
      } else {
        const start2 = content.indexOf('{');
        const end2 = content.lastIndexOf('}');
        if (start2 >= 0 && end2 > start2) {
          try {
            parsed = JSON.parse(content.slice(start2, end2 + 1));
            console.log(`  🟡 brace slice OK · shots=${parsed.shots?.length ?? '?'}`);
          } catch {
            console.log(`  ❌ brace slice fail · NO JSON anywhere`);
          }
        } else {
          console.log(`  ❌ no { / } in content`);
        }
      }
    }
  } catch (e) {
    console.log(`  ⛔ exception: ${e.message}`);
  }
}

// 矩阵测试
await testCombo('Sonnet 4.6 · baseline', 'claude-sonnet-4-6');
await testCombo('Sonnet 4.6 · response_format=json_object', 'claude-sonnet-4-6', {
  response_format: { type: 'json_object' },
});
await testCombo('Sonnet 4.6 · prefill assistant `{`', 'claude-sonnet-4-6', {}, undefined);
// 跑 prefill 单独需要改 messages,下面专做
console.log('\n--- prefill 模式 ---');
{
  const body = {
    model: 'claude-sonnet-4-6',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: SCENE_SHORT },
      { role: 'assistant', content: '{"shots":[' },
    ],
    max_tokens: 2048,
    temperature: 0.3,
  };
  const start = Date.now();
  const resp = await fetch(`${relay.apiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - start;
  const text = await resp.text();
  console.log(`Sonnet 4.6 + assistant prefill { "shots": [`);
  if (resp.status !== 200) {
    console.log(`  HTTP ${resp.status}:`, text.slice(0, 200));
  } else {
    const j = JSON.parse(text);
    const c = j.choices?.[0]?.message?.content ?? '';
    console.log(`  ✓ ${ms}ms · in/out: ${j.usage?.prompt_tokens}/${j.usage?.completion_tokens}`);
    console.log(`  raw content first 300:\n  ${c.slice(0, 300).replace(/\n/g, '\n  ')}`);
  }
}

await testCombo('Gemini 3 Flash · baseline', 'gemini-3-flash-preview');
await testCombo('Gemini 3 Flash · response_format', 'gemini-3-flash-preview', {
  response_format: { type: 'json_object' },
});

await testCombo('Haiku 4.5 · baseline (对照)', 'claude-haiku-4-5-20251001');

// ============================================================
// 真实 storyboard system prompt 重测 — 验证假设:长 system prompt 让 Sonnet 入戏写 markdown
// ============================================================
const REAL_SYSTEM = `你是经验丰富的短剧分镜师。任务：把单场剧本拆解为视频生成可用的分镜列表。

【输入】你会收到一场剧本（含场号、时段、内外、地点、人物、动作行/对白/旁白）+ 4 大预设值清单(framing/angle/movement/lighting)

【输出严格 JSON】
{
  "shots": [
    {
      "index": 1,
      "framing": "特写" | "近景" | "中景" | "全景" | ...,
      "angle": "平视 0°" | "俯视 30°" | "仰视 15°" | "侧拍 45°" | ...,
      "movement": "固定" | "推" | "拉" | "摇" | "移" | "跟" | "升降" | "甩",
      "lighting": "自然光" | "硬光" | "柔光" | "逆光" | "侧光" | "低调" | "高调" | "冷调" | "暖调",
      "content": "30 字内描述这一镜的画面内容",
      "durationS": 1-5,
      "priority": "S" | "A" | "B" | "C",
      "prompt": "视频生成的完整提示词，融合 framing + angle + movement + lighting + content + 美术风格 + 台词/OS"
    }
  ]
}

【拆镜原则】
1. 每个对白/旁白单独成镜（除非两句台词紧贴同一动作）
2. 每个动作行（△ 起头）单独成镜
3. 重要表情、道具特写单独成镜
4. 默认镜头时长 1-3 秒；爽点/反转给 3-5 秒
5. priority：爽点反转 S；冲突高潮 A；叙事推进 B；过渡 C

【framing/angle/movement/lighting 选值】
- 4 个字段都**必须**从【可选预设】清单里挑;清单里没有的值用空字符串 "" 不要瞎编
- movement / lighting 允许 ""(不强求所有镜都有运镜光线设计;固定镜 + 自然光是默认)

【提示词写作】
- 起手：景别 + 角度 + 主体
- 含：环境、光线、表情、动作、运镜
- 台词放在末尾，格式 "角色名：台词"
- OS 旁白格式 "角色名（OS）：旁白文字"
- 引用人物用 @ 前缀（系统会自动替换为人物特征）— 例：@陆乘 走入

【字数控制】
- content：30 字以内
- prompt：100-150 字

【输出格式 — 严格遵守,违反则系统报错】
⛔ 禁止任何 markdown 元素:不要 # 标题、不要 ## 二级标题、不要 ** 加粗、不要 - 列表、不要 | 表格、不要 \`\`\` 代码块、不要任何说明文字
⛔ 禁止"以下是分镜表"之类的前置说明
⛔ 禁止 JSON 之外的任何字符(空格 / 换行 OK,但不能有 markdown / 解释 / 代码块标记)
✅ 直接从 { 开始,以 } 结尾的**纯 JSON**
✅ 第一个字符必须是 {

示例正确输出(直接复制此结构填值):{"shots":[{"index":1,"framing":"特写","angle":"平视 0°","movement":"固定","lighting":"自然光","content":"...","durationS":3,"priority":"B","prompt":"..."}]}`;

console.log('\n\n' + '#'.repeat(80));
console.log('# 用 storyboard router 真实 system prompt 重测');
console.log('#'.repeat(80));
await testCombo('Sonnet 4.6 · REAL system prompt', 'claude-sonnet-4-6', { response_format: { type: 'json_object' } }, REAL_SYSTEM);
await testCombo('Gemini 3 Flash · REAL system prompt', 'gemini-3-flash-preview', { response_format: { type: 'json_object' } }, REAL_SYSTEM);
await testCombo('Haiku 4.5 · REAL system prompt', 'claude-haiku-4-5-20251001', { response_format: { type: 'json_object' } }, REAL_SYSTEM);

await prisma.$disconnect();
