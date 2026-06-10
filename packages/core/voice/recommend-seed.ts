/**
 * 按人物设定推荐种子声线(六八:声音设定进生成链路)。
 *
 * MOSS-TTS-Nano 不支持自然语言音色控制(只有 18 条内置声线 + 参考音频克隆),
 * 「声音设定描述」的落地方式 = 用它挑最贴的内置声线:
 *   1. voiceLabel 关键词命中(命中多者胜) → 2. 性别+年龄启发 → 3. 维持 UI 默认 Yuewen。
 * 纯函数,UI 默认选中推荐项,用户可改。
 */
import { NANO_BUILTIN_VOICES } from './weights.js';

/**
 * 中文种子声线人工标注特征。
 * 音色依据:官方 manifest 的 group(性别)+ display_name(样本内容)—
 *   Junhao「欢迎关注模思智能」/ Zhiming「京味胡同闲聊」/ Weiguo「说书」/
 *   Xiaoyu「明星」/ Yuewen「机车」/ Lingyu「深夜电台」(2026-06-10 快照)。
 * keywords 是设定描述里的命中词,真打听感不符可直接改表。
 */
const ZH_SEED_TRAITS: Record<string, { vibe: string; keywords: string[] }> = {
  Junhao: {
    vibe: '标准青年男声',
    keywords: ['标准', '青年', '阳光', '正经', '沉稳', '播音', '干净', '少年', '清朗'],
  },
  Zhiming: {
    vibe: '京味闲聊男声',
    keywords: ['京', '市井', '痞', '油', '幽默', '闲聊', '接地气', '逗', '贫', '风趣'],
  },
  Weiguo: {
    vibe: '说书苍劲男声',
    keywords: ['低沉', '浑厚', '苍劲', '沙哑', '年长', '老', '说书', '旁白', '威严', '沧桑', '厚重'],
  },
  Xiaoyu: {
    vibe: '明亮女声(明星范)',
    keywords: ['明亮', '甜', '少女', '活泼', '清脆', '元气', '俏皮', '明星', '软'],
  },
  Yuewen: {
    vibe: '飒爽利落女声(机车)',
    keywords: ['飒', '利落', '帅气', '中性', '酷', '干练', '英气'],
  },
  Lingyu: {
    vibe: '低沉温柔女声(深夜电台)',
    // 注:「低沉」同时在 Weiguo 表里 — 性别已知时池子不相交;性别未知时按声线表顺序 Lingyu 先命中
    keywords: ['温柔', '低沉', '知性', '电台', '治愈', '御姐', '成熟', '磁性', '轻柔', '柔和'],
  },
};

export interface SeedRecommendation {
  /** 内置声线名(不含 builtin: 前缀) */
  seed: string;
  /** 推荐理由(UI 直接展示) */
  reason: string;
}

/** 按角色设定推荐种子声线 — 永远有返回(无线索时退 UI 默认) */
export function recommendSeedVoice(input: {
  gender?: string | null;
  age?: number | null;
  /** 声音设定描述(profileJson.voiceLabel) */
  voiceLabel?: string | null;
}): SeedRecommendation {
  const g = input.gender === 'MALE' ? 'M' : input.gender === 'FEMALE' ? 'F' : null;
  const zhSeeds = NANO_BUILTIN_VOICES.filter((v) => v.lang === 'zh');
  const pool = g ? zhSeeds.filter((v) => v.gender === g) : zhSeeds;
  const label = (input.voiceLabel ?? '').trim();

  // 1. 声音设定描述关键词命中(命中数多者胜,平手按声线表顺序)
  if (label) {
    let best: { name: string; hits: string[] } | null = null;
    for (const v of pool) {
      const traits = ZH_SEED_TRAITS[v.name];
      if (!traits) continue;
      const hits = traits.keywords.filter((k) => label.includes(k));
      if (hits.length > 0 && (best === null || hits.length > best.hits.length)) {
        best = { name: v.name, hits };
      }
    }
    if (best) {
      const vibe = ZH_SEED_TRAITS[best.name]?.vibe ?? best.name;
      return {
        seed: best.name,
        reason: `设定「${best.hits.join('/')}」≈ ${vibe}`,
      };
    }
  }

  // 2. 性别 + 年龄启发(描述没命中关键词时的兜底)
  if (g === 'M') {
    if ((input.age ?? 0) >= 50) {
      return { seed: 'Weiguo', reason: '男 · 年长 → 说书苍劲男声' };
    }
    return { seed: 'Junhao', reason: '男声 → 标准青年男声' };
  }
  if (g === 'F') {
    if ((input.age ?? 0) >= 40) {
      return { seed: 'Lingyu', reason: '女 · 成熟 → 低沉温柔女声' };
    }
    return { seed: 'Xiaoyu', reason: '女声 → 明亮女声' };
  }

  // 3. 无任何线索 → 维持现 UI 默认
  return { seed: 'Yuewen', reason: '未填性别/声音描述,默认声线' };
}
