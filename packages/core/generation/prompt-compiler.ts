/**
 * Prompt 编译器
 *
 * 将"模板 + 风格 + 资产 + 镜头参数"组合成最终下发给模型的 prompt
 *
 * 编译流程：
 *   1. 取 StyleProfile（项目级 / 资产级 override）
 *   2. 替换 @资产占位符 → 实际资产描述
 *   3. 合并镜头景别/角度等参数
 *   4. 附加全局禁止词
 *   5. 缓存编译结果（hash）便于回溯
 */
import { createHash } from 'node:crypto';

export interface CompileInput {
  shotPrompt: string;          // 用户编辑的镜头 prompt（含 @资产占位）
  framing?: string;            // "特写" / "中景" / "全景"
  angle?: string;              // "平视 0°" / "仰视 30°"
  styleSnippet?: string;       // 来自 StyleProfile
  forbiddenWords?: string[];
  assetDescriptions?: Record<string, string>; // assetName → 资产形象描述
  aspectRatio?: '9:16' | '16:9' | '1:1';
  modelHint?: string;
}

export interface CompileResult {
  prompt: string;
  hash: string;
  metadata: {
    assetsUsed: string[];
    styleApplied: boolean;
    aspectRatio: string;
  };
}

/**
 * 编译镜头 prompt
 */
export function compileShotPrompt(input: CompileInput): CompileResult {
  const parts: string[] = [];
  const assetsUsed: string[] = [];

  // 1. 景别 / 角度前置
  if (input.framing || input.angle) {
    parts.push([input.framing, input.angle].filter(Boolean).join(' '));
  }

  // 2. 风格头
  if (input.styleSnippet) {
    parts.push(input.styleSnippet);
  }

  // 3. 主体（替换资产占位）
  let body = input.shotPrompt;
  if (input.assetDescriptions) {
    // 替换 @角色[陆萌萌] 占位符为实际描述
    body = body.replace(/@(?:角色|场景|道具)\[([^\]]+)\]/g, (match, name) => {
      const desc = input.assetDescriptions?.[name];
      if (desc) {
        assetsUsed.push(name);
        return `（${name}：${desc}）`;
      }
      return match;
    });
  }
  parts.push(body);

  // 4. 禁止词
  if (input.forbiddenWords && input.forbiddenWords.length > 0) {
    parts.push(`严格禁止：${input.forbiddenWords.join('、')}`);
  }

  // 5. 比例约束（部分模型需要）
  if (input.aspectRatio) {
    parts.push(`输出比例：${input.aspectRatio}`);
  }

  const prompt = parts.join('\n\n').trim();
  const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);

  return {
    prompt,
    hash,
    metadata: {
      assetsUsed,
      styleApplied: !!input.styleSnippet,
      aspectRatio: input.aspectRatio ?? '9:16',
    },
  };
}
