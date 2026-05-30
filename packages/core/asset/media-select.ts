/**
 * 资产 7 槽位 mediaId 选择 — 单一真相源
 *
 * 三十九收工:原 fallback 链在 3 处逐字重复(易漂移 → 真隐患):
 *   - aigc.getGroupDetail(routers/aigc.ts)
 *   - aigc.previewCompiledPrompt(routers/aigc.ts)
 *   - video-generation/compile.ts(compileVideoPromptForGroup)
 * 抽此 helper 统一,改一处全跟随。
 *
 * fallback 链(W1-W5 audit P1-6 定义):
 *   AUDIO           → voiceMediaId
 *   CHARACTER       → portrait → threeView → main
 *   SCENE           → sceneMain → sceneFront → sceneLeft → sceneRight → sceneBack → panorama → main
 *   PROP/STYLE/其它  → main
 */
export interface AssetMediaSlots {
  type: string;
  voiceMediaId: string | null;
  portraitMediaId: string | null;
  threeViewMediaId: string | null;
  mainMediaId: string | null;
  sceneMainMediaId: string | null;
  sceneFrontMediaId: string | null;
  sceneLeftMediaId: string | null;
  sceneRightMediaId: string | null;
  sceneBackMediaId: string | null;
  panoramaMediaId: string | null;
}

/**
 * 按资产类型 + 引用 kind 选出最合适的 mediaId(7 槽位 fallback)。
 *
 * @param kind 'AUDIO' → 走配音槽;其余('IMAGE')→ 按 asset.type 走图像链
 * @returns 选中的 mediaId,全空时 null
 */
export function pickAssetMediaId(
  asset: AssetMediaSlots,
  kind: 'IMAGE' | 'AUDIO',
): string | null {
  if (kind === 'AUDIO') return asset.voiceMediaId;
  if (asset.type === 'CHARACTER') {
    return asset.portraitMediaId ?? asset.threeViewMediaId ?? asset.mainMediaId;
  }
  if (asset.type === 'SCENE') {
    return (
      asset.sceneMainMediaId ??
      asset.sceneFrontMediaId ??
      asset.sceneLeftMediaId ??
      asset.sceneRightMediaId ??
      asset.sceneBackMediaId ??
      asset.panoramaMediaId ??
      asset.mainMediaId
    );
  }
  return asset.mainMediaId;
}
