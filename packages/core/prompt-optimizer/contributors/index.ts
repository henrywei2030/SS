/**
 * M6 首批 ContextContributor(蓝图 §5.2):shot / assets / style / continuity。
 *
 * 新增维度的姿势:加一个对象进 ALL_CONTRIBUTORS + 在 admin 系统设置
 * prompt.optimizer.contributors 开关里加 key — 优化器核心(optimize.ts)零改动。
 * 渲染约定:返回「【段名】\n内容」整段;该维度无内容返回 null(段落直接消失)。
 */
import type { OptimizeContext, PromptContextContributor } from '../types.js';

import { knowledgeContributor } from './knowledge.js';

/** 镜头四维设计:优化器的画面骨架真相源(分镜表数据,非自由文本) */
const shotContributor: PromptContextContributor = {
  key: 'shot',
  order: 10,
  async render(ctx: OptimizeContext): Promise<string | null> {
    if (ctx.shots.length === 0) return null;
    const lines = ctx.shots.map((s, i) => {
      const dims = [
        s.framing && `景别:${s.framing}`,
        s.angle && `角度:${s.angle}`,
        s.movement && `运镜:${s.movement}`,
        s.lighting && `光线:${s.lighting}`,
        s.sound && `音效:${s.sound}`,
        `时长:${s.durationS}s`,
        s.priority && `优先级:${s.priority}`,
      ]
        .filter(Boolean)
        .join(' | ');
      return `镜${i + 1}(${dims})\n内容:${s.content}`;
    });
    return `【镜头设计】(共 ${ctx.shots.length} 镜,优化时逐镜对应,不增减)\n${lines.join('\n')}`;
  },
};

/** 绑定资产:@token 指向谁 + 各自的核心设定摘要 */
const assetsContributor: PromptContextContributor = {
  key: 'assets',
  order: 20,
  async render(ctx: OptimizeContext): Promise<string | null> {
    if (ctx.assets.length === 0) return null;
    const lines = ctx.assets.map((a) => {
      const slot = a.token ?? '(无 token)';
      return `${slot} = ${a.name}(${a.type})${a.promptBrief ? `:${a.promptBrief}` : ''}`;
    });
    return `【绑定资产】(token → 实体对照,token 必须逐字保留)\n${lines.join('\n')}`;
  },
};

/** 项目风格:全剧统一规约 + 禁用词 */
const styleContributor: PromptContextContributor = {
  key: 'style',
  order: 30,
  async render(ctx: OptimizeContext): Promise<string | null> {
    const s = ctx.style;
    if (!s) return null;
    const lines = [
      s.characterPrompt && `人物风格:${s.characterPrompt}`,
      s.scenePrompt && `场景风格:${s.scenePrompt}`,
      s.propPrompt && `道具风格:${s.propPrompt}`,
      s.forbiddenWords.length > 0 && `禁用词(正文不得出现):${s.forbiddenWords.join('、')}`,
    ].filter(Boolean);
    if (lines.length === 0) return null;
    return `【项目风格】\n${lines.join('\n')}`;
  },
};

/** 上组衔接:同场景时给承接素材(蓝图 §4.4 衔接注记 — 优化时即时推导,不落库) */
const continuityContributor: PromptContextContributor = {
  key: 'continuity',
  order: 40,
  async render(ctx: OptimizeContext): Promise<string | null> {
    const p = ctx.prevGroup;
    if (!p) return null;
    if (!p.sameScene) {
      return `【上组衔接】上一组(组 ${p.number})已切场 — 本组是新场景开场,不做动作承接,但保持人物外观/光线基调一致。`;
    }
    const tail = p.lastShotContent ? `上组末镜内容:${p.lastShotContent}` : `上组提示词结尾:${p.prompt.slice(-200)}`;
    return `【上组衔接】同场景接续(组 ${p.number})。${tail}\n据此在开头交代承接(人物位置/朝向/光线/动作余势)。`;
  },
};

export const ALL_CONTRIBUTORS: PromptContextContributor[] = [
  shotContributor,
  assetsContributor,
  styleContributor,
  continuityContributor,
  // H1(docs/07):八维知识库检索(独立文件 contributors/knowledge.ts,Planner 确定性规划)
  knowledgeContributor,
];
