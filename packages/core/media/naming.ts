/**
 * 媒体文件中文命名规范(2026-06-10 六八)
 *
 * 约定:**主体中文名为核心**,`主体_用途[_序]`;所有 AIGC 生成物统一走这里,
 * 用户上传保留原文件名。filename 只是素材库展示名(对象存储真相是 storageKey 的
 * uuid 路径),不要求全局唯一,但要求一眼读懂「这是谁的什么」。
 *
 * 示例:
 *   人物声线   林小满_参考声音.m4a
 *   规范化音频 林小满_参考声音_规范化.m4a
 *   生成图     林小满_形象_0610-1.png / 天台_主视角_0610-2.png
 *   分镜视频   星垣往事_第2集_分镜G3_第1次.mp4
 *   整集成片   星垣往事_第2集_成片_第1次.mp4
 */

/**
 * 文件名片段消毒:替换文件系统非法字符 + 控制符为 `_`(中文/全角标点/空格/连字符保留),
 * 空白折叠、连续 `_` 合并,裁到 maxLen。空输入返回 ''(调用方自行兜底)。
 */
export function sanitizeMediaName(raw: string, maxLen = 60): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[/\\:*?"<>|\x00-\x1f]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/_{2,}/g, '_')
      .trim()
      .slice(0, maxLen)
  );
}

/** 生成槽位 → 中文用途标签(SlotSchema 同序;未知槽位回退原串) */
export const SLOT_LABEL_ZH: Record<string, string> = {
  portrait: '形象',
  three_view: '三视图',
  scene_main: '主视角',
  scene_front: '正面',
  scene_left: '左侧',
  scene_right: '右侧',
  scene_back: '背面',
  panorama: '全景',
  main: '主图',
  detail: '细节',
  reference: '参考',
};

/** AssetType → MediaItem.assetCategory(素材库筛选用;STYLE_REFERENCE 等归 OTHER) */
export function assetCategoryFromType(
  assetType: string,
): 'CHARACTER' | 'SCENE' | 'PROP' | 'OTHER' {
  return assetType === 'CHARACTER' || assetType === 'SCENE' || assetType === 'PROP'
    ? assetType
    : 'OTHER';
}

/** 人物 TTS 声线样本:`林小满_参考声音.mp3`(七二第十波:m4a→mp3,参考音频投喂只认 mp3/wav) */
export function voiceSampleFilename(assetName: string): string {
  return `${sanitizeMediaName(assetName) || '角色'}_参考声音.mp3`;
}

/** 规范化音频(版本链):原名去扩展名 + `_规范化.mp3`(七二第十波:m4a→mp3) */
export function normalizedVoiceFilename(originalFilename: string): string {
  const base = originalFilename.replace(/\.[a-zA-Z0-9]+$/, '');
  return `${sanitizeMediaName(base) || '参考声音'}_规范化.mp3`;
}

/**
 * 资产生成图:`主体_用途_MMDD-序.png`(同日多抽靠序号区分,跨日靠日期)。
 * labelOverride:槽位双语义场景用(如 three_view 对场景是「九宫格」对人物是「三视图」)。
 */
export function assetImageFilename(
  assetName: string,
  slot: string,
  at: Date,
  index: number,
  labelOverride?: string,
): string {
  const subject = sanitizeMediaName(assetName) || '资产';
  const label = labelOverride ?? SLOT_LABEL_ZH[slot] ?? sanitizeMediaName(slot);
  const mmdd = `${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
  return `${subject}_${label}_${mmdd}-${index + 1}.png`;
}

/** 分镜视频 take:`项目_第E集_分镜G_第K次.mp4` */
export function shotTakeFilename(
  projectName: string | null | undefined,
  episodeNumber: number | null | undefined,
  groupNumber: string | null | undefined,
  takeSeq: number,
): string {
  const proj = sanitizeMediaName(projectName ?? '') || '项目';
  const ep = episodeNumber ? `第${episodeNumber}集` : '本集';
  const grp = sanitizeMediaName(String(groupNumber ?? '')) || '组';
  return `${proj}_${ep}_分镜${grp}_第${takeSeq}次.mp4`;
}

/** M3a 关键帧候选:`项目_第E集_分镜G_关键帧_MMDD-序.png` */
export function keyframeFilename(
  projectName: string | null | undefined,
  episodeNumber: number | null | undefined,
  groupNumber: string | null | undefined,
  at: Date,
  index: number,
): string {
  const proj = sanitizeMediaName(projectName ?? '') || '项目';
  const ep = episodeNumber ? `第${episodeNumber}集` : '本集';
  const grp = sanitizeMediaName(String(groupNumber ?? '')) || '组';
  const mmdd = `${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
  return `${proj}_${ep}_分镜${grp}_关键帧_${mmdd}-${index + 1}.png`;
}

/** M3b 尾帧链:`项目_第E集_分镜G_尾帧链.png`(G = 来源组,写到下一组首帧) */
export function tailFrameFilename(
  projectName: string | null | undefined,
  episodeNumber: number | null | undefined,
  groupNumber: string | null | undefined,
): string {
  const proj = sanitizeMediaName(projectName ?? '') || '项目';
  const ep = episodeNumber ? `第${episodeNumber}集` : '本集';
  const grp = sanitizeMediaName(String(groupNumber ?? '')) || '组';
  return `${proj}_${ep}_分镜${grp}_尾帧链.png`;
}

/** 整集成片基名(无扩展名,.mp4/.srt 共用):`项目_第E集_成片_第K次` */
export function episodeRenderBasename(
  projectName: string | null | undefined,
  episodeNumber: number,
  seq: number,
): string {
  const proj = sanitizeMediaName(projectName ?? '') || '项目';
  return `${proj}_第${episodeNumber}集_成片_第${seq}次`;
}
