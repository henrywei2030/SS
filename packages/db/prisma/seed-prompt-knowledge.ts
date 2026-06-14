/**
 * H0(docs/07 §3):PromptKnowledge 八维知识库种子语料 v1(~83 条)。
 *
 * 来源(D-B):
 *   - 八要素实战文章(docs/07 §0):强化词五类 / 抽象词翻译对 / 时间轴切片 / 避坑五条
 *   - storyboard_main v2 模板蒸馏(seed.ts):轴线/景别阶梯/角度心理学/运镜动机/光影编码
 * 形态两种:
 *   - 词条型(QUALITY/CONSTRAINT/LIGHTING/STYLE/部分 SCENE):content = 可直接注入的词组
 *   - 规则型(ACTION 翻译对/CAMERA 语法/SUBJECT 纪律):content = 给 Composer LLM 的检索片段
 * tags 形状见 core/prompt-knowledge/retrieval.ts KnowledgeTags:
 *   family 空 = 全模型家族通用;keywords = 降级链关键词检索锚(在组正文中找)。
 * embedding 一律不在 seed 算(懒回填,docs/07 §4.5 — 离线/无 key 可 seed)。
 */
import { PromptDimension } from '../src/generated/prisma/client.js';

export interface SeedKnowledgeEntry {
  slug: string;
  dimension: PromptDimension;
  title: string;
  content: string;
  tags?: {
    family?: string[];
    style?: string[];
    mood?: string[];
    era?: string[];
    keywords?: string[];
  };
}

const D = PromptDimension;

export const SEED_PROMPT_KNOWLEDGE: SeedKnowledgeEntry[] = [
  // ===========================================================================
  // QUALITY 画质(8)— 文章"质量保险丝"画质类
  // ===========================================================================
  {
    slug: 'pk_quality_base_film',
    dimension: D.QUALITY,
    title: '电影质感基础三件套',
    content: '4K超高清、电影质感、细节丰富',
    tags: { keywords: ['画质'] },
  },
  {
    slug: 'pk_quality_film_grain',
    dimension: D.QUALITY,
    title: '胶片颗粒感',
    content: '胶片颗粒感、轻微暗角',
    tags: { style: ['复古', '写实'], mood: ['怀旧'] },
  },
  {
    slug: 'pk_quality_hdr',
    dimension: D.QUALITY,
    title: 'HDR 高动态范围',
    content: 'HDR高动态范围、亮部不过曝、暗部细节保留',
    tags: { keywords: ['逆光', '夜'] },
  },
  {
    slug: 'pk_quality_depth',
    dimension: D.QUALITY,
    title: '浅景深主体分离',
    content: '浅景深、主体锐利对焦、背景柔和虚化',
    tags: { keywords: ['特写', '近景'] },
  },
  {
    slug: 'pk_quality_texture',
    dimension: D.QUALITY,
    title: '材质纹理细节',
    content: '皮肤纹理真实、织物质感清晰、表面材质细节丰富',
    tags: { style: ['写实'] },
  },
  {
    slug: 'pk_quality_color_grading',
    dimension: D.QUALITY,
    title: '电影级调色',
    content: '电影级调色、色彩层次丰富、肤色自然',
  },
  {
    slug: 'pk_quality_kling_keywords',
    dimension: D.QUALITY,
    title: 'kling 系关键词堆叠',
    content: '8K、超高清、大师级构图、获奖摄影作品',
    tags: { family: ['kling'] },
  },
  {
    slug: 'pk_quality_lens_optics',
    dimension: D.QUALITY,
    title: '镜头光学感',
    content: '35mm电影镜头、自然光晕、轻微暗角',
    tags: { style: ['写实', '复古'] },
  },

  // ===========================================================================
  // CONSTRAINT 约束/稳定(10)— 文章"质量保险丝"稳定类(省掉 ≈ 10 条 7 返工)
  // ===========================================================================
  {
    slug: 'pk_constraint_face',
    dimension: D.CONSTRAINT,
    title: '面部稳定',
    content: '面部清晰不变形、五官一致',
    tags: { keywords: ['脸', '面部', '表情'] },
  },
  {
    slug: 'pk_constraint_body',
    dimension: D.CONSTRAINT,
    title: '人体比例',
    content: '人体比例自然、四肢结构正确',
  },
  {
    slug: 'pk_constraint_motion',
    dimension: D.CONSTRAINT,
    title: '动作流畅',
    content: '动作流畅连贯无跳帧、运动轨迹物理合理',
  },
  {
    slug: 'pk_constraint_hands',
    dimension: D.CONSTRAINT,
    title: '手部完整',
    content: '手指完整自然、手部动作清晰不畸变',
    tags: { keywords: ['手', '拿', '递', '抓', '握', '抚'] },
  },
  {
    slug: 'pk_constraint_identity',
    dimension: D.CONSTRAINT,
    title: '跨镜一致',
    content: '人物外观、发型、服装全程一致,不换脸不换装',
  },
  {
    slug: 'pk_constraint_clean_frame',
    dimension: D.CONSTRAINT,
    title: '画面干净',
    content: '无字幕、无水印、无台标、无边框',
  },
  {
    slug: 'pk_constraint_no_gibberish',
    dimension: D.CONSTRAINT,
    title: '禁乱码文字',
    content: '画面中不出现乱码文字与无意义字符',
    tags: { keywords: ['招牌', '报纸', '信', '字'] },
  },
  {
    slug: 'pk_constraint_closeup_face',
    dimension: D.CONSTRAINT,
    title: '特写防崩',
    content: '特写时面部结构稳定、眼神聚焦自然、牙齿不畸变',
    tags: { keywords: ['特写'] },
  },
  {
    slug: 'pk_constraint_crowd_count',
    dimension: D.CONSTRAINT,
    title: '人数恒定',
    content: '多人场景人数恒定、不凭空增减人物',
    tags: { keywords: ['两人', '三人', '人群', '众人', '村民'] },
  },
  {
    slug: 'pk_constraint_physics',
    dimension: D.CONSTRAINT,
    title: '物理常识',
    content: '物体受力与重力合理、液体布料运动自然',
    tags: { keywords: ['摔', '倒', '泼', '撞', '砸'] },
  },

  // ===========================================================================
  // LIGHTING 光影(12)— 文章光影类强化词 + v2 时段锚定/情绪编码
  // ===========================================================================
  {
    slug: 'pk_lighting_warm_backlight',
    dimension: D.LIGHTING,
    title: '暖黄逆光',
    content: '暖黄逆光、发丝光勾边',
    tags: { mood: ['温情', '治愈'], keywords: ['夕阳', '回忆', '相拥'] },
  },
  {
    slug: 'pk_lighting_tyndall',
    dimension: D.LIGHTING,
    title: '丁达尔效应',
    content: '丁达尔效应、光束穿透尘埃雾气',
    tags: { keywords: ['树林', '窗', '雾', '尘', '仓库'] },
  },
  {
    slug: 'pk_lighting_moonlight',
    dimension: D.LIGHTING,
    title: '月光冷色调',
    content: '月光冷色调、蓝青色月光洒落',
    tags: { mood: ['孤独', '悬疑'], keywords: ['夜', '月', '深夜'] },
  },
  {
    slug: 'pk_lighting_golden_hour',
    dimension: D.LIGHTING,
    title: '黄金时刻',
    content: '黄金时刻暖光、长影斜照',
    tags: { keywords: ['黄昏', '夕阳', '傍晚', '日落'] },
  },
  {
    slug: 'pk_lighting_blue_hour',
    dimension: D.LIGHTING,
    title: '蓝调时刻',
    content: '蓝调时刻、天光未尽的青蓝色',
    // '晨' 含覆盖 清晨/早晨/晨曦(H1 端到端验证时发现 时段「晨」零命中)
    tags: { keywords: ['黎明', '凌晨', '入夜', '天没亮', '晨'] },
  },
  {
    slug: 'pk_lighting_lowkey_side',
    dimension: D.LIGHTING,
    title: '低调侧光',
    content: '低调侧光、人物半明半暗',
    tags: { mood: ['压抑', '紧张'], keywords: ['密谋', '审视', '对峙'] },
  },
  {
    slug: 'pk_lighting_top_oppress',
    dimension: D.LIGHTING,
    title: '顶光压迫',
    content: '顶光直射、眼窝阴影加深',
    tags: { mood: ['压迫'], keywords: ['审', '逼问', '质问'] },
  },
  {
    slug: 'pk_lighting_rim',
    dimension: D.LIGHTING,
    title: '轮廓光分离',
    content: '轮廓光勾边、主体与背景分离',
    tags: { keywords: ['剪影', '背影'] },
  },
  {
    slug: 'pk_lighting_candle',
    dimension: D.LIGHTING,
    title: '烛光油灯',
    content: '烛光油灯暖橘色光源、光影摇曳',
    tags: { era: ['民国', '古代', '年代'], keywords: ['烛', '油灯', '灯笼', '煤油灯'] },
  },
  {
    slug: 'pk_lighting_neon',
    dimension: D.LIGHTING,
    title: '霓虹冷暖对撞',
    content: '霓虹冷暖对撞、青橙色调',
    tags: { style: ['赛博朋克'], keywords: ['霓虹', '酒吧', '夜市', '都市夜'] },
  },
  {
    slug: 'pk_lighting_overcast',
    dimension: D.LIGHTING,
    title: '阴天漫射',
    content: '阴天柔和漫射光、低饱和度',
    tags: { mood: ['低落', '日常'], keywords: ['阴天', '雨后'] },
  },
  {
    slug: 'pk_lighting_rule_anchor',
    dimension: D.LIGHTING,
    title: '时段锚定规则',
    content:
      '同一场内光源方向与色温必须一致:日戏=自然光/硬光,黄昏=暖调/逆光,夜戏=低调/冷调;反转摊牌瞬间可用光变强化(如转低调冷调),光变动机写进画面描述',
  },

  // ===========================================================================
  // SCENE 场景(10)— 氛围类强化词 + 年代/空间具体化规则
  // ===========================================================================
  {
    slug: 'pk_scene_mood_healing',
    dimension: D.SCENE,
    title: '治愈清新',
    content: '治愈清新氛围、空气通透、绿意盎然',
    tags: { mood: ['治愈'] },
  },
  {
    slug: 'pk_scene_mood_tense',
    dimension: D.SCENE,
    title: '紧张压抑',
    content: '紧张压抑氛围、空间逼仄、阴影浓重',
    tags: { mood: ['紧张', '压抑'] },
  },
  {
    slug: 'pk_scene_mood_bleak',
    dimension: D.SCENE,
    title: '肃杀冷峻',
    content: '肃杀冷峻氛围、冷色调、空旷无人',
    tags: { mood: ['肃杀'], keywords: ['对决', '雪', '荒野'] },
  },
  {
    slug: 'pk_scene_mood_lively',
    dimension: D.SCENE,
    title: '市井烟火气',
    content: '市井烟火气、蒸汽热气、嘈杂招牌人流',
    tags: { keywords: ['市场', '小吃', '街', '集市', '摊'] },
  },
  {
    slug: 'pk_scene_mood_ruin',
    dimension: D.SCENE,
    title: '荒凉破败',
    content: '荒凉破败、灰尘蛛网、剥落墙皮',
    tags: { keywords: ['废', '破', '旧屋', '荒'] },
  },
  {
    slug: 'pk_scene_rain_wet',
    dimension: D.SCENE,
    title: '雨夜湿冷',
    content: '雨夜湿冷、地面积水反光、雨丝清晰可见',
    tags: { keywords: ['雨', '伞', '淋'] },
  },
  {
    slug: 'pk_scene_era_rule',
    dimension: D.SCENE,
    title: '年代细节写死规则',
    content:
      'AI 不懂历史:年代背景必须写死具体视觉细节(如"1942年华北农村:土坯墙、煤油灯、补丁棉袄"),不要只写"民国/古代/年代感"泛词',
    tags: { keywords: ['年代', '民国', '古代', '朝'] },
  },
  {
    slug: 'pk_scene_space_depth',
    dimension: D.SCENE,
    title: '空间三层法',
    content: '场景写出前景/中景/背景三层(前景遮挡物、中景主体、背景环境),画面立刻有纵深',
  },
  {
    slug: 'pk_scene_season_anchor',
    dimension: D.SCENE,
    title: '季节视觉锚定',
    content:
      '季节用视觉细节锚定:冬=呵气成霜积雪残冰,夏=蝉鸣汗渍烈日浓影,秋=落叶枯黄,春=新绿花苞 — 不要只写季节名',
    tags: { keywords: ['冬', '夏', '秋', '春', '季'] },
  },
  {
    slug: 'pk_scene_interior_dress',
    dimension: D.SCENE,
    title: '室内定调陈设',
    content: '室内场景写出 2-3 件定调陈设(挂历/奖状/神龛/老式电视),让空间有主人感与年代感',
    tags: { keywords: ['屋', '房', '室内', '家'] },
  },

  // ===========================================================================
  // STYLE 风格(8)— 文章风格类强化词
  // ===========================================================================
  {
    slug: 'pk_style_ink_anime',
    dimension: D.STYLE,
    title: '水墨动漫风',
    content: '水墨动漫风、留白构图、墨色晕染',
    tags: { style: ['水墨'] },
  },
  {
    slug: 'pk_style_ghibli',
    dimension: D.STYLE,
    title: '吉卜力',
    content: '吉卜力风格、手绘质感、温暖色板',
    tags: { style: ['吉卜力', '2D'] },
  },
  {
    slug: 'pk_style_shinkai',
    dimension: D.STYLE,
    title: '新海诚',
    content: '新海诚风格、通透天空、绚丽光斑',
    tags: { style: ['新海诚', '2D'] },
  },
  {
    slug: 'pk_style_cyberpunk',
    dimension: D.STYLE,
    title: '赛博朋克',
    content: '赛博朋克、霓虹反光、高对比都市夜景',
    tags: { style: ['赛博朋克'] },
  },
  {
    slug: 'pk_style_film_retro',
    dimension: D.STYLE,
    title: '胶片复古',
    content: '90年代胶片质感、暖褐色调、轻微过曝',
    tags: { style: ['复古'], era: ['年代'] },
  },
  {
    slug: 'pk_style_realistic_film',
    dimension: D.STYLE,
    title: '写实电影感',
    content: '写实电影感、自然表演质感、纪实镜头语言',
    tags: { style: ['写实'] },
  },
  {
    slug: 'pk_style_3d_guoman',
    dimension: D.STYLE,
    title: '3D 国漫',
    content: '3D国漫渲染、皮肤次表面散射、衣料物理飘动',
    tags: { style: ['国漫', '3D'] },
  },
  {
    slug: 'pk_style_vertical_drama',
    dimension: D.STYLE,
    title: '竖屏短剧构图',
    content: '竖屏构图、人物占画面主导、关键信息集中在中轴线',
  },

  // ===========================================================================
  // ACTION 动作(15)— 抽象词→具体画面翻译对(文章避坑①②核心)
  // ===========================================================================
  {
    slug: 'pk_action_rule_micro',
    dimension: D.ACTION,
    title: '微观死磕纪律',
    content:
      '抽象情绪词必须翻译成具体可拍的画面动作,写到声音/触感级(文章例:"紧张"→"手在油灯下颤抖着揭开木板,指节发白")— 模型拍不出形容词,只拍得出动作',
  },
  {
    slug: 'pk_action_nervous',
    dimension: D.ACTION,
    title: '紧张的翻译',
    content: '紧张→手指无意识摩挲衣角/喉结滚动/视线快速扫过门窗/呼吸变浅变快',
    tags: { keywords: ['紧张', '不安', '忐忑'] },
  },
  {
    slug: 'pk_action_angry',
    dimension: D.ACTION,
    title: '愤怒的翻译',
    content: '愤怒→下颌咬肌鼓起/捏皱手中纸张/指节抵桌发白/额角青筋跳动',
    tags: { keywords: ['愤怒', '怒', '气'] },
  },
  {
    slug: 'pk_action_sad',
    dimension: D.ACTION,
    title: '悲伤的翻译',
    content: '悲伤→睫毛颤动强忍泪意/喉头哽住欲言又止/指尖轻抚旧物/肩线塌陷',
    tags: { keywords: ['悲伤', '哭', '泪', '难过'] },
  },
  {
    slug: 'pk_action_fear',
    dimension: D.ACTION,
    title: '恐惧的翻译',
    content: '恐惧→瞳孔骤缩/后背贴墙缓缓挪移/死死抓紧身边物件/腿软扶桌',
    tags: { keywords: ['恐惧', '害怕', '惊', '吓'] },
  },
  {
    slug: 'pk_action_hesitate',
    dimension: D.ACTION,
    title: '犹豫的翻译',
    content: '犹豫→手伸到一半停住/张口又闭欲言又止/脚步在门槛前迟疑打转',
    tags: { keywords: ['犹豫', '迟疑', '踌躇'] },
  },
  {
    slug: 'pk_action_resolute',
    dimension: D.ACTION,
    title: '决绝的翻译',
    content: '决绝→深吸一口气挺直脊背/将物件重重按在桌上/转身大步不回头',
    tags: { keywords: ['决绝', '决定', '下定', '狠心'] },
  },
  {
    slug: 'pk_action_joy',
    dimension: D.ACTION,
    title: '喜悦的翻译',
    content: '喜悦→眼角细纹绽开/脚步轻快带跳/嘴角压不住地上扬',
    tags: { keywords: ['喜悦', '开心', '高兴', '笑'] },
  },
  {
    slug: 'pk_action_guilty',
    dimension: D.ACTION,
    title: '心虚的翻译',
    content: '心虚→目光躲闪不敢对视/手心出汗在裤缝反复擦拭/答话支支吾吾',
    tags: { keywords: ['心虚', '慌', '躲闪'] },
  },
  {
    slug: 'pk_action_threaten',
    dimension: D.ACTION,
    title: '威胁的翻译',
    content: '威胁→俯身逼近压低声音/指尖一下下敲击桌面/把玩对方在意的物件',
    tags: { keywords: ['威胁', '逼', '警告'] },
  },
  {
    slug: 'pk_action_collapse',
    dimension: D.ACTION,
    title: '崩溃的翻译',
    content: '崩溃→双膝一软跪地/十指插入头发攥紧/无声张嘴嘶吼',
    tags: { keywords: ['崩溃', '绝望', '瘫'] },
  },
  {
    slug: 'pk_action_sound_touch',
    dimension: D.ACTION,
    title: '声音触感级描写',
    content: '动作描写带上声音与触感:瓷碗磕在桌沿脆响/粗布摩擦掌心/雨水顺着下颌滴落 — 比纯视觉多一层真实',
  },
  {
    slug: 'pk_action_speed',
    dimension: D.ACTION,
    title: '速率词纪律',
    content: '动作必须写明速率:缓缓/猛地/急促/迟缓 — 同一动作不同速率是完全不同的镜头',
  },
  {
    slug: 'pk_action_fight',
    dimension: D.ACTION,
    title: '打斗具体化',
    content: '打斗写具体招式与受力反馈(拳头擦过颧骨/踉跄撞翻条凳/抹去嘴角血迹),不写"激烈打斗"',
    tags: { keywords: ['打', '斗', '揍', '扭打', '挥拳'] },
  },
  {
    slug: 'pk_action_prop_interact',
    dimension: D.ACTION,
    title: '道具外化情绪',
    content: '情绪借道具外化:摔杯/折断筷子/撕碎信纸/攥紧药瓶 — 比面部特写更有戏剧张力',
    tags: { keywords: ['摔', '撕', '攥', '捏'] },
  },

  // ===========================================================================
  // CAMERA 镜头语言(14)— v2 模板蒸馏 + 文章时间轴切片
  // ===========================================================================
  {
    slug: 'pk_camera_axis_180',
    dimension: D.CAMERA,
    title: '180°轴线',
    content: '对话正反打守 180° 轴线不跳轴;要变轴线须用运动镜或空镜过渡',
    tags: { keywords: ['对话', '对峙', '争吵', '质问'] },
  },
  {
    slug: 'pk_camera_framing_ladder',
    dimension: D.CAMERA,
    title: '景别阶梯',
    content: '相邻镜景别要有阶梯变化(全景→特写比全景→中景更有冲击);同景别连切勿超过 2 镜',
  },
  {
    slug: 'pk_camera_angle_psy',
    dimension: D.CAMERA,
    title: '角度心理学',
    content:
      '角度即立场:平视=客观;仰视拍强势方=权力压迫;俯视拍弱势方=渺小无助;侧拍斜角=不安失衡;过肩=对峙关系',
  },
  {
    slug: 'pk_camera_movement_motive',
    dimension: D.CAMERA,
    title: '运镜动机表',
    content:
      '无动机不动机位:推=聚焦/逼近真相;拉=揭示环境/孤立感;摇=视线引导/空间扫描;移跟=伴随人物/追逐紧张;升降=命运感/段落转场;甩=暴力转场/时间跳跃',
  },
  {
    slug: 'pk_camera_static_ratio',
    dimension: D.CAMERA,
    title: '六成固定配比',
    content: '固定镜为主(约六成),运动镜留给情绪拐点;爽点/反转前用固定镜蓄力,爆发瞬间才动',
  },
  {
    slug: 'pk_camera_cut_rhythm',
    dimension: D.CAMERA,
    title: '动接动衔接律',
    content: '衔接律:动接动、静接静;上镜推近,下镜勿立即拉远',
  },
  {
    slug: 'pk_camera_golden_structure',
    dimension: D.CAMERA,
    title: '黄金结构',
    content: '"全景交代→中景动作→特写情绪→拉远收尾"黄金结构;禁一镜到底',
  },
  {
    slug: 'pk_camera_beat_rhythm',
    dimension: D.CAMERA,
    title: '3-4 秒节奏点',
    content: '15 秒内安排 3-4 个节奏点(每 3-4 秒一个画面变化:动作转折/景别切换/光线变化),观众不划走',
  },
  {
    slug: 'pk_camera_push_emotion',
    dimension: D.CAMERA,
    title: '推镜时机',
    content: '缓推配情绪积聚(逼近角色内心),急推配惊变瞬间(发现/认出/惊醒)',
    tags: { keywords: ['发现', '认出', '惊', '原来'] },
  },
  {
    slug: 'pk_camera_handheld',
    dimension: D.CAMERA,
    title: '手持不安感',
    content: '手持轻微晃动传递不安与纪实感,用于追逐/慌乱/偷窥视角',
    tags: { keywords: ['追', '逃', '偷看', '慌', '跑'] },
  },
  {
    slug: 'pk_camera_closeup_timing',
    dimension: D.CAMERA,
    title: '特写时机',
    content: '特写留给关键信息与情绪峰值(道具入手/眼神变化/落泪瞬间);滥用特写会稀释冲击力',
    tags: { keywords: ['特写'] },
  },
  {
    slug: 'pk_camera_empty_shot',
    dimension: D.CAMERA,
    title: '空镜过渡',
    content: '空镜(环境/天空/物件)用于时间流逝、情绪留白与轴线重置,1-2 秒即可',
    tags: { keywords: ['转场', '过渡', '清晨', '日落'] },
  },
  {
    slug: 'pk_camera_pov',
    dimension: D.CAMERA,
    title: '主观视角',
    content: '主观 POV 镜头让观众代入角色所见,配合轻微手持与呼吸节奏',
    tags: { keywords: ['看见', '视角', '目光', '盯'] },
  },
  {
    slug: 'pk_camera_foreground_block',
    dimension: D.CAMERA,
    title: '前景遮挡构图',
    content: '前景遮挡构图(门框/窗棂/人群缝隙)制造偷窥感与空间纵深',
    tags: { keywords: ['偷', '窥', '缝', '门口', '窗外'] },
  },

  // ===========================================================================
  // SUBJECT 主体(6)— 锚定与一致性纪律(系统已有 @token/图投喂,这里是写法规则)
  // ===========================================================================
  {
    slug: 'pk_subject_token_anchor',
    dimension: D.SUBJECT,
    title: '@token 锚定',
    content:
      '人物/场景/道具一律用 @token 引用(系统注入形象参考),不要用代词"他/她/那人"指代主体 — 代词会让模型自由发挥外观',
  },
  {
    slug: 'pk_subject_appearance_lock',
    dimension: D.SUBJECT,
    title: '出场即定装',
    content: '主体出场即定装:发型/服装/关键配饰一次写清,后续镜头沿用同一描述词不改写',
  },
  {
    slug: 'pk_subject_unique_focus',
    dimension: D.SUBJECT,
    title: '主体唯一性',
    content: '每镜明确唯一视觉主体;多人镜头写清空间关系(谁前谁后/谁左谁右)与各自动作,主次分明',
    tags: { keywords: ['两人', '三人', '众人'] },
  },
  {
    slug: 'pk_subject_face_anchor',
    dimension: D.SUBJECT,
    title: '面部锚点细节',
    content: '人物特写带 1-2 个面部锚点细节(眉骨疤痕/泪痣/胡茬),提升跨镜一致性',
    tags: { keywords: ['特写', '脸'] },
  },
  {
    slug: 'pk_subject_wardrobe_era',
    dimension: D.SUBJECT,
    title: '服装写实化',
    content: '服装写材质与年代特征(粗布对襟/的确良衬衫/呢子大衣),不写"古装/民国装"泛词',
    tags: { era: ['民国', '古代', '年代'], keywords: ['衣', '装', '袍'] },
  },
  {
    slug: 'pk_subject_ref_image_first',
    dimension: D.SUBJECT,
    title: '参考图优先纪律',
    content: '有形象参考图时文字与图保持一致,文字只补图无法表达的动作与情绪 — 文字与图打架时模型输出撕裂',
    tags: { family: ['happyhorse'] },
  },
  // ===========================================================================
  // 七二第十波(2026-06):Seedance 2.0 prompt 最佳实践蒸馏(海外官方/社区调研)
  //   来源:apiyi/seedance2.ai prompt guide · github awesome-seedance-2-prompts ·
  //   make-prompt-seedance2 · volcengine 肖像版权安全。family 标 seedance 对症。
  // ===========================================================================
  {
    slug: 'pk_sd2_single_camera_move',
    dimension: D.CAMERA,
    title: 'Seedance 单一主运镜',
    content: '一条提示词只给一个主运镜(推/拉/摇/跟/环绕/航拍/手持/固定择一),多个运镜叠加会互相打架、画面漂移 — 运镜复杂度留给分镜切换而非单镜堆叠',
    tags: { family: ['seedance'], keywords: ['运镜', '镜头'] },
  },
  {
    slug: 'pk_sd2_intent_over_steps',
    dimension: D.ACTION,
    title: 'Seedance 写意图不写琐碎步骤',
    content: 'Seedance 2.0 有世界知识,描述导演意图与视觉方向即可,过度分解琐碎动作步骤反降质 — 写「熟练颠勺爆炒」而非逐帧拆「抬锅/翻面/落锅」',
    tags: { family: ['seedance'] },
  },
  {
    slug: 'pk_sd2_camera_intent',
    dimension: D.CAMERA,
    title: '运镜语义意图',
    content: '推近=沉浸/逼近真相,拉远=揭示环境/孤立,环绕=多面展示/动感,跟拍=伴随紧张,固定=克制蓄力 — 选运镜先问叙事动机',
    tags: { family: ['seedance'], keywords: ['运镜'] },
  },
  {
    slug: 'pk_sd2_motion_pace_words',
    dimension: D.CONSTRAINT,
    title: '节奏词替代裸"快"',
    content: '描述运动用 slow/smooth/stable/gradual/gentle(缓稳渐进)等节奏词;裸用 "fast/快速" 易掉帧崩画面 — 要快感用「急促短促的动作」描述具体动作而非速度形容词',
    tags: { family: ['seedance'], keywords: ['动作', '速率'] },
  },
  {
    slug: 'pk_sd2_lighting_leverage',
    dimension: D.LIGHTING,
    title: '光照是性价比最高的质量杠杆',
    content: '光照描述是所有要素里对成片质感提升最大的一项 — 每个镜头务必写足光位/方向/质感/色温(柔和窗光/逆光勾边/体积光丁达尔),宁详勿略',
    tags: { keywords: ['光', '光影'] },
  },
  {
    slug: 'pk_sd2_ref_asset_lock',
    dimension: D.SUBJECT,
    title: '@素材锁角色一致性',
    content: 'prompt 里用 @名字 引用人物/场景/道具,下游据此注入参考图锁外观;同一主体跨镜全程同名同描述,是跨镜一致性与后期拆解归并的根基',
    tags: { family: ['seedance'], keywords: ['一致性', '主体'] },
  },
  {
    slug: 'pk_sd2_style_lock',
    dimension: D.STYLE,
    title: '风格锚点防漂移',
    content: '强风格须锁定锚点词并贯穿全程(二维动漫锁 cel-shading+flat color、3D 锁 stylized render+SSS),一条 prompt 不混搭两种子风格 — 否则模型在风格间漂移、跨镜不一致',
    tags: { keywords: ['风格'] },
  },
  {
    slug: 'pk_sd2_no_ip_celebrity',
    dimension: D.CONSTRAINT,
    title: '规避 IP/明星/品牌(肖像版权安全)',
    content: '不写明星真名/真人肖像、不点名受版权作品与角色、不用真实品牌商标 — 改用「视觉手法」描述(吉卜力式→hand-painted watercolor;皮克斯式→smooth 3D+SSS;某游戏→stylized cel-shaded 3D);人物用原创虚构名',
    tags: { keywords: ['禁用', '版权', '合规'] },
  },
  {
    slug: 'pk_sd2_content_safety',
    dimension: D.CONSTRAINT,
    title: '内容安全规避类目',
    content: '规避暴力血腥、色情成人、政治人物/符号、违禁品(毒品武器)、未成年不当、宗教冒犯等敏感内容 — 冲突/打斗用动作张力与受力反馈表现,不渲染血腥',
    tags: { keywords: ['禁用', '合规', '安全'] },
  },
  {
    slug: 'pk_sd2_scene_three',
    dimension: D.SCENE,
    title: '场景三要素:地点+光照+氛围',
    content: '环境描述 = 具体地点 + 光照(方向/质感/色温) + 氛围(雾/尘/湿润/温度感),三者齐备模型才建得出有空气感的空间 — 缺光照=平板,缺氛围=塑料',
    tags: { family: ['seedance'], keywords: ['场景', '环境'] },
  },
];
