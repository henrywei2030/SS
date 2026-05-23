/**
 * 剧本文件 → 纯文本提取器
 *
 * 按文件扩展名分发，输出最终交给 parseScriptText 的纯文本。
 * 设计原则：
 *   - 文本类输入尽量保留剧本结构（场头、动作行、对白）— 不轻易丢内容
 *   - 富文本格式（docx/rtf/html/md）做格式去标，让 parser 拿到干净的「字符流」
 *   - 不识别的扩展名直接抛错，让前端提示用户
 */
import mammoth from 'mammoth';

export interface ExtractResult {
  text: string;
  /** 文件格式标识，便于审计 / 训练数据集回溯 */
  format: ScriptFileFormat;
}

export type ScriptFileFormat = 'docx' | 'txt' | 'md' | 'rtf' | 'html';

const SUPPORTED_EXTS: Record<string, ScriptFileFormat> = {
  docx: 'docx',
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  rtf: 'rtf',
  html: 'html',
  htm: 'html',
};

/** 前端 input[accept] 用 */
export const ACCEPTED_FILE_EXTS = Object.keys(SUPPORTED_EXTS)
  .map((e) => `.${e}`)
  .join(',');

/**
 * 把任意支持的剧本文件 Buffer 转成纯文本
 *
 * 调用方传 filename（用于扩展名识别）+ buffer。
 * 失败时抛 Error，message 适合直接展示给前端。
 *
 * W1-W5 audit P1 followup(P1-5):docxParser 接通 binding.script.docx.parser
 *   当前只支持 'mammoth';传其它值会抛 NOT_IMPLEMENTED,提醒接入新 parser 时这里 switch。
 *   不接通时 binding 为死配置 — admin 改了不生效。
 */
export type DocxParser = 'mammoth';

export async function extractScriptText(
  buffer: Buffer,
  filename: string,
  opts?: { docxParser?: string },
): Promise<ExtractResult> {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const format = SUPPORTED_EXTS[ext];
  if (!format) {
    throw new Error(
      `不支持的文件格式: ${ext ? `.${ext}` : '(无扩展名)'} — 支持 ${ACCEPTED_FILE_EXTS}`,
    );
  }

  let text: string;
  switch (format) {
    case 'docx': {
      const docxParser = opts?.docxParser ?? 'mammoth';
      if (docxParser !== 'mammoth') {
        throw new Error(
          `docx parser "${docxParser}" 暂未接入(SystemSetting binding.script.docx.parser),当前只支持 mammoth`,
        );
      }
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      break;
    }
    case 'txt':
      text = buffer.toString('utf-8');
      break;
    case 'md':
      text = stripMarkdown(buffer.toString('utf-8'));
      break;
    case 'rtf':
      text = stripRtf(buffer.toString('utf-8'));
      break;
    case 'html':
      text = stripHtml(buffer.toString('utf-8'));
      break;
  }

  // 统一收尾：去 BOM、规范换行、去多余空行
  text = text
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, format };
}

// ---------------------------------------------------------------------------
// 富文本去标
// ---------------------------------------------------------------------------

/**
 * Markdown 去标 — 只去掉影响 parser 的格式符号，保留剧本字符流
 *
 * 例：`## 1-1 日 内 房间` → `1-1 日 内 房间`（场头被 parser 识别）
 *     `**陆乘**（害怕）：...` → `陆乘（害怕）：...`
 */
function stripMarkdown(s: string): string {
  return (
    s
      // 标题 # / ## ... 起头
      .replace(/^#{1,6}\s+/gm, '')
      // 代码块 ``` ... ```
      .replace(/```[\s\S]*?```/g, '')
      // 行内 code `xxx`
      .replace(/`([^`]+)`/g, '$1')
      // 加粗 **xxx** / __xxx__
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // 斜体 *xxx* / _xxx_
      .replace(/(?<![*])\*([^*\n]+)\*(?![*])/g, '$1')
      .replace(/(?<![_])_([^_\n]+)_(?![_])/g, '$1')
      // 列表 - / * / + 起头
      .replace(/^\s*[-*+]\s+/gm, '')
      // 有序列表 `1. ` 不去 — 可能是剧本编号
      // 引用 > 起头
      .replace(/^\s*>\s+/gm, '')
      // 链接 [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // 图片 ![alt](url) → 删
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      // 水平分隔线
      .replace(/^---+$/gm, '')
  );
}

/**
 * RTF 去控制码 — 栈式扫描,正确处理嵌套 group + 破坏性 group
 *
 * 关键场景:
 *   - `{\fonttbl{\f0 Songti SC;}}` — fonttbl 是"破坏性 group",内容整段丢
 *   - `{\b 陆乘\b0 你好}` — 普通 group,内容保留
 *   - `\par` / `\line` → 换行
 *   - `\'a4` — hex 字符转义,Phase 1 直接丢(中文剧本极少用)
 *   - `\\` → 字面反斜杠
 *
 * 不追求 100% RTF 兼容，只要把人类可读文字抽出来。
 */
function stripRtf(s: string): string {
  const result: string[] = [];
  // 栈表示当前是否在"丢弃 group"内
  const skipStack: boolean[] = [false];
  // 命中即整段丢内容的 destructive control words
  const DESTRUCTIVE = /^\\(\*|fonttbl|stylesheet|colortbl|listtable|rsidtbl|generator|info|themedata|datastore|latentstyles|operator|author|company|title|subject)\b/;

  let i = 0;
  const inSkip = (): boolean => skipStack[skipStack.length - 1] === true;

  while (i < s.length) {
    const c = s[i];
    if (c === undefined) break;

    if (c === '{') {
      const peek = s.slice(i + 1, i + 20);
      const startsDestructive = DESTRUCTIVE.test(peek);
      skipStack.push(startsDestructive || inSkip());
      i++;
      continue;
    }

    if (c === '}') {
      skipStack.pop();
      if (skipStack.length === 0) skipStack.push(false); // 防御性兜底
      i++;
      continue;
    }

    if (c === '\\') {
      // 控制字 \word(-?\d+)?
      const m = s.slice(i).match(/^\\([a-zA-Z]+)(-?\d+)?\s?/);
      if (m) {
        if (!inSkip()) {
          if (m[1] === 'par' || m[1] === 'line') result.push('\n');
          else if (m[1] === 'tab') result.push('\t');
          // 其它控制字(\b \f0 \fs24 等)丢弃
        }
        i += m[0].length;
        continue;
      }
      // \'xx hex 字符
      if (s[i + 1] === "'" && /^[0-9a-fA-F]{2}/.test(s.slice(i + 2, i + 4))) {
        i += 4;
        continue;
      }
      // \\ 字面反斜杠
      if (s[i + 1] === '\\') {
        if (!inSkip()) result.push('\\');
        i += 2;
        continue;
      }
      // 其它 \X 一律丢
      i += 2;
      continue;
    }

    if (!inSkip()) result.push(c);
    i++;
  }

  return result.join('');
}

/**
 * HTML 去标签 — 抗"嵌套标签绕过"(如 `<scrip<script>t>`)
 *
 * 策略:循环 strip 直到字符串不再变化,最后用 `<[^>]+>` 做兜底确保没有残留 `<...>`。
 * 上限 8 轮防 pathological 输入。
 */
function stripHtml(s: string): string {
  const stripOnce = (input: string): string =>
    input
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');

  let prev = s;
  let curr = stripOnce(prev);
  for (let n = 0; n < 8 && curr !== prev; n++) {
    prev = curr;
    curr = stripOnce(prev);
  }

  return (
    curr
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      // 兜底:任何残留 <...> 一律删
      .replace(/<[^>]+>/g, '')
      // 常见 HTML entity
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  );
}
