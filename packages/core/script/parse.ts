/**
 * 剧本解析器（纯文本 → 结构化场/对白/动作）
 *
 * 输入格式（参考截图原系统剧本样式）：
 *   1-1 日 内 陆乘家破土屋        ← 场头：集.场 + 时段 + 内外 + 地点
 *   《剧名》                      ← 可选：标题
 *   人物：陆乘、陆萌萌、王大富   ← 可选：本场角色清单
 *   △陆乘被一阵咳嗽声惊醒。      ← 动作行：以 △ 起头
 *   陆萌萌（害怕）：哥，我……    ← 对白行：角色（情绪）：台词
 *   陆乘（OS）：我重生了！        ← 旁白行：情绪标注包含 "OS"
 *
 * 设计原则：
 *   - 零外部依赖（docx → text 由调用方在 packages/api 处理 mammoth）
 *   - 容错优先：不识别的行降级为 action 行，永不丢内容
 *   - 全角 / 半角标点都接受
 */

export interface ParsedScript {
  title?: string;
  scenes: ParsedScene[];
  /** 未归入任何场的孤儿行（剧本前言、签名等） */
  preamble: string[];
}

export interface ParsedScene {
  number: string; // "1-1"
  episodeNumber: number;
  sceneNumber: number;
  timeOfDay: SceneTimeOfDay;
  location: SceneLocation;
  place: string;
  characters: string[];
  lines: ParsedLine[];
  /** 整场原文（含所有行，便于回灌 Script.content / Scene.content） */
  rawContent: string;
}

export interface ParsedLine {
  kind: 'action' | 'dialog' | 'voiceover' | 'note';
  raw: string;
  speaker?: string;
  emotion?: string;
  text: string;
}

export type SceneTimeOfDay = 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';
export type SceneLocation = 'INDOOR' | 'OUTDOOR' | 'MIXED';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseScriptText(text: string): ParsedScript {
  const lines = text.split(/\r?\n/);

  const result: ParsedScript = {
    scenes: [],
    preamble: [],
  };

  let current: ParsedScene | null = null;
  const currentRaw: string[] = [];

  const flushScene = (): void => {
    if (current) {
      current.rawContent = currentRaw.join('\n').trim();
      result.scenes.push(current);
    }
    currentRaw.length = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current) currentRaw.push('');
      continue;
    }

    // 标题 `《...》` 任意位置出现一次即采纳
    const title = matchTitle(line);
    if (title && !result.title) {
      result.title = title;
      if (current) currentRaw.push(line);
      continue;
    }

    // 1. 场头
    const sceneHead = matchSceneHead(line);
    if (sceneHead) {
      flushScene();
      current = sceneHead;
      currentRaw.push(line);
      continue;
    }

    // 还没进场 → 收到 preamble（剧名、说明、签名等）
    if (!current) {
      result.preamble.push(line);
      continue;
    }

    currentRaw.push(line);

    // 2. 场内的特殊行
    const characters = matchCharacterList(line);
    if (characters) {
      // 合并到当前场（去重，保留出现顺序）
      const set = new Set(current.characters);
      for (const c of characters) {
        if (!set.has(c)) {
          set.add(c);
          current.characters.push(c);
        }
      }
      continue;
    }

    // 3. 内容行
    current.lines.push(classifyLine(line));
  }

  flushScene();

  // Phase 1.5.3 精炼 5:短剧 / 自由格式 fallback
  // 全文未识别到任何场头("1-1 日 内 地点"格式) → 整段作为一个默认场塞进去
  // 让 LLM 接管拆镜:generateStoryboard 能直接读自然段 + "【镜头N】" 标记自动产出 shot
  if (result.scenes.length === 0 && text.trim().length > 0) {
    result.scenes.push({
      number: '1-1',
      episodeNumber: 1,
      sceneNumber: 1,
      timeOfDay: 'DAY',
      location: 'INDOOR',
      place: '未指定',
      characters: [],
      lines: [],
      rawContent: text.trim(),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal — line classifiers
// ---------------------------------------------------------------------------

/**
 * 场头：`1-1 日 内 陆乘家破土屋` / `1-1 夜 外 街道` / `2-3 晨 内外 走廊→院子`
 */
function matchSceneHead(line: string): ParsedScene | null {
  // 集-场 时段 内外 地点
  // - 时段：日 / 夜 / 晨 / 昏 / 早 / 晚（单字）
  // - 内外：必须是 内 / 外 / 内外（整词），不再用字符类匹配多余组合
  const m = line.match(/^(\d+)\s*[-－]\s*(\d+)\s+([日夜晨昏早晚])\s+(内外|内|外)\s+(.+?)$/);
  if (!m) return null;

  const episodeNumber = Number(m[1]);
  const sceneNumber = Number(m[2]);
  if (Number.isNaN(episodeNumber) || Number.isNaN(sceneNumber)) return null;

  return {
    number: `${episodeNumber}-${sceneNumber}`,
    episodeNumber,
    sceneNumber,
    timeOfDay: parseTimeOfDay(m[3] ?? ''),
    location: parseLocation(m[4] ?? ''),
    place: (m[5] ?? '').trim(),
    characters: [],
    lines: [],
    rawContent: '',
  };
}

function parseTimeOfDay(c: string): SceneTimeOfDay {
  switch (c) {
    case '晨':
    case '早':
      return 'DAWN';
    case '日':
      return 'DAY';
    case '昏':
    case '晚':
      return 'DUSK';
    case '夜':
      return 'NIGHT';
    default:
      return 'DAY';
  }
}

function parseLocation(s: string): SceneLocation {
  if (s === '内外') return 'MIXED';
  if (s === '外') return 'OUTDOOR';
  return 'INDOOR';
}

/** 《剧名》— 标题行 */
function matchTitle(line: string): string | null {
  const m = line.match(/^[《](.+?)[》]\s*$/);
  return m ? (m[1] ?? null) : null;
}

/** `人物：陆乘、陆萌萌、王大富、小弟（两人）` */
function matchCharacterList(line: string): string[] | null {
  const m = line.match(/^人物\s*[:：]\s*(.+)$/);
  if (!m) return null;
  const inner = m[1] ?? '';
  return inner
    .split(/[、，,]/)
    .map((s) => s.replace(/[（(].*?[)）]/g, '').trim())
    .filter(Boolean);
}

/**
 * 内容行分类：动作 / 对白 / 旁白 / 注释
 *
 * - △ 起头 = 动作
 * - 角色（OS / 旁白 / VO 标注）：台词 = 旁白
 * - 角色（情绪/状态）：台词 = 对白
 * - 角色：台词 = 对白
 * - 其它 = 注释（保留原文）
 */
function classifyLine(line: string): ParsedLine {
  // 动作行：△ 或 ▲ 起头
  if (/^[△▲]/.test(line)) {
    return {
      kind: 'action',
      raw: line,
      text: line.replace(/^[△▲]\s*/, ''),
    };
  }

  // 对白 / 旁白：`角色（情绪）：台词` 或 `角色：台词`
  //
  // speaker 字符规则：
  //   - 首字符：中文 / 拉丁字母（不允许数字开头，避免误识 "1983年4月12日" 这种日期前缀）
  //   - 余下：中文 / 字母 / 数字
  //   - 总长 1-12（避免把长动作行误识成 speaker）
  //   - 排除空格、标点、引号、括号
  const SPEAKER = String.raw`[一-龥A-Za-z][一-龥A-Za-z0-9]{0,11}`;
  const dialogMatch =
    line.match(new RegExp(`^(${SPEAKER})\\s*[（(]([^）)]+)[）)]\\s*[:：]\\s*(.+)$`)) ??
    line.match(new RegExp(`^(${SPEAKER})\\s*[:：]\\s*(.+)$`));

  if (dialogMatch) {
    const speaker = (dialogMatch[1] ?? '').trim();
    const hasEmotion = dialogMatch.length === 4;
    const emotion = hasEmotion ? (dialogMatch[2] ?? '').trim() : undefined;
    const text = (hasEmotion ? dialogMatch[3] : dialogMatch[2]) ?? '';

    const isVoiceover = !!emotion && /(OS|VO|旁白|画外音)/i.test(emotion);

    return {
      kind: isVoiceover ? 'voiceover' : 'dialog',
      raw: line,
      speaker,
      emotion,
      text: text.trim(),
    };
  }

  // 兜底：当成注释
  return {
    kind: 'note',
    raw: line,
    text: line,
  };
}

/**
 * 从任意文本块提取台词行(对白 + 旁白)— M1 成片 SRT 用(蓝图:台词用剧本解析同款正则)。
 * 复用 classifyLine 的同一套 speaker/对白正则,杜绝两处正则漂移。
 * 输入通常是 Shot.content(单镜原文,含 △动作 / 台词 / 注释混排)。
 */
export function extractDialogueLines(content: string): ParsedLine[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(classifyLine)
    .filter((l) => (l.kind === 'dialog' || l.kind === 'voiceover') && l.text.length > 0);
}

// ---------------------------------------------------------------------------
// 多集切分(短剧 / 网剧格式) — Phase 1.5.3
// ---------------------------------------------------------------------------

export interface EpisodeBoundary {
  /** 1-based,从"第N集"标题识别 */
  episodeNumber: number;
  /** 标题部分(":" 后的内容),无则空 */
  title: string;
  /** 该集完整原文(含标题行) */
  content: string;
  /** 该集解析后的场数(用 parseScriptText 二次解析) */
  sceneCount: number;
}

/**
 * 切多集 — 把一份含多集的文本按 "第N集" 标题切到各集。
 *
 * 识别规则(任一匹配即视为新集开始):
 *   - `第1集` / `第 1 集`
 *   - `第1集：抠门租客` / `第1集 抠门租客`
 *   - `Episode 1` / `EP 1` / `EP1` (英文兼容)
 *
 * 切分规则:
 *   - 标题行**之前**的所有内容算 preamble(剧名 / 作者签名等),弃用
 *   - 标题行**之后**到下一个标题行(或 EOF)间为该集 content
 *   - 每集 content 再喂给 parseScriptText 拿 sceneCount(短剧场头识别率可能 0,但允许)
 *
 * 单集 fallback:
 *   - 全文没匹配到 `第N集` 标题 → 返回单元素数组 `[{ episodeNumber: 1, content: text }]`
 *
 * 二十三收工 Phase 1.5.3:支持"一份 docx 含 Ep1-N,自动切到各集"
 */
export function parseEpisodeBoundaries(text: string): EpisodeBoundary[] {
  const HEAD_RE =
    /^\s*(?:第\s*(\d+)\s*集|Episode\s+(\d+)|EP\s*(\d+))\s*[:：]?\s*(.*)$/i;
  const lines = text.split(/\r?\n/);

  type Frame = { episodeNumber: number; title: string; buf: string[] };
  const frames: Frame[] = [];
  let current: Frame | null = null;

  for (const rawLine of lines) {
    const m = rawLine.match(HEAD_RE);
    if (m) {
      const n = Number(m[1] ?? m[2] ?? m[3]);
      if (!Number.isNaN(n) && n > 0) {
        if (current) frames.push(current);
        current = { episodeNumber: n, title: (m[4] ?? '').trim(), buf: [rawLine] };
        continue;
      }
    }
    if (current) current.buf.push(rawLine);
  }
  if (current) frames.push(current);

  if (frames.length === 0) {
    return [
      {
        episodeNumber: 1,
        title: '',
        content: text,
        sceneCount: parseScriptText(text).scenes.length,
      },
    ];
  }

  return frames.map((f) => {
    const content = f.buf.join('\n').trim();
    return {
      episodeNumber: f.episodeNumber,
      title: f.title,
      content,
      sceneCount: parseScriptText(content).scenes.length,
    };
  });
}

