/**
 * useVideoSettings — AigcWorkspace 视频生成派生 state + 跟随 capabilities 的 effects
 *
 * 三十三收工 R1 Phase A2:
 * 把 aigc-workspace.tsx 主组件内 4 个 video setting state + 4 个 capabilities 跟随 effect
 * 集中到 hook,纯重构零行为变化。
 *
 * **不管 selectedProviderId** — 它是用户主动选 + capabilities query input,
 * 留主组件管理避免 hook 跟 query 循环依赖。
 *
 * State:
 *   - aspectRatio       画面比例(初始跟项目,capabilities 切换时 fallback)
 *   - durationS         生成时长(默认 group 复杂度 + capabilities clamp)
 *   - resolution        分辨率(切 Provider 时 fallback 到 defaultResolution)
 *   - generateAudio     音频开关(不支持音频的 Provider 切回 false)
 *
 * Effects(4 个,自动跟随 capabilities/groupDetail 变化):
 *   - capabilities + group 加载后 → 算 durationS 智能默认
 *   - capabilities 首次或切换时 → 初始化 / fallback aspectRatio(useRef 防 flag effect 重跑)
 *   - capabilities 切换 → fallback resolution
 *   - capabilities 不支持音频 → reset generateAudio = false
 */
import * as React from 'react';

import type { AspectRatio } from '@ss/shared/constants';

// hook 接 capabilities / groupDetail 作为 input(minimal interface,
// 不依赖 trpc inferRouterOutputs 避免 hook 文件耦合 router)
export interface CapabilitiesInfo {
  minDurationS: number;
  maxDurationS: number;
  supportedAspectRatios: AspectRatio[] | readonly AspectRatio[];
  supportedResolutions: Array<'480p' | '720p' | '1080p'> | readonly ('480p' | '720p' | '1080p')[];
  defaultResolution: '480p' | '720p' | '1080p';
  supportsAudio: boolean;
}

export interface GroupDetailInfo {
  group: { durationS: number; episodeId: string };
  project?: { aspect?: string | null } | null;
}

export interface VideoSettings {
  aspectRatio: AspectRatio;
  setAspectRatio: React.Dispatch<React.SetStateAction<AspectRatio>>;
  durationS: number;
  setDurationS: React.Dispatch<React.SetStateAction<number>>;
  resolution: '480p' | '720p' | '1080p';
  setResolution: React.Dispatch<React.SetStateAction<'480p' | '720p' | '1080p'>>;
  generateAudio: boolean;
  setGenerateAudio: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useVideoSettings(input: {
  capabilities: CapabilitiesInfo | null | undefined;
  groupDetail: GroupDetailInfo | null | undefined;
}): VideoSettings {
  const { capabilities, groupDetail } = input;

  const [aspectRatio, setAspectRatio] = React.useState<AspectRatio>('9:16');
  const [durationS, setDurationS] = React.useState<number>(5);
  const [resolution, setResolution] = React.useState<'480p' | '720p' | '1080p'>('720p');
  // 2026-05-27 用户反馈:音频默认勾选(Seedance 2.0 docs §15 generate_audio 默认 true)
  const [generateAudio, setGenerateAudio] = React.useState<boolean>(true);

  // W5.5 D6:capabilities + group 加载后,按 group 复杂度 + Provider 上限设默认 durationS
  React.useEffect(() => {
    if (!capabilities || !groupDetail) return;
    const groupDur = Math.round(groupDetail.group.durationS) || 5;
    const def = Math.min(
      Math.max(groupDur, capabilities.minDurationS),
      capabilities.maxDurationS,
    );
    setDurationS(def);
  }, [capabilities, groupDetail]);

  // 用户反馈 2026-05-27:首次默认 aspect 跟项目 aspect 走;切 Provider fallback 到 first
  // 2026-05-27 audit r14 P1:用 useRef 替代 useState 防 provider 快速切换初始化逻辑被打断
  const aspectRatioInitializedRef = React.useRef(false);
  React.useEffect(() => {
    if (!capabilities) return;
    if (aspectRatioInitializedRef.current) {
      if (!capabilities.supportedAspectRatios.includes(aspectRatio)) {
        const first = capabilities.supportedAspectRatios[0];
        if (first) setAspectRatio(first);
      }
      return;
    }
    if (!groupDetail) return;
    const candidate = groupDetail.project?.aspect as AspectRatio | undefined;
    if (candidate && capabilities.supportedAspectRatios.includes(candidate)) {
      setAspectRatio(candidate);
    } else {
      const first = capabilities.supportedAspectRatios[0];
      if (first) setAspectRatio(first);
    }
    aspectRatioInitializedRef.current = true;
  }, [capabilities, groupDetail, aspectRatio]);

  // W5.5.1:capabilities 加载后,同步默认分辨率(切 Provider 时 list 可能变)
  React.useEffect(() => {
    if (!capabilities) return;
    setResolution((prev) =>
      capabilities.supportedResolutions.includes(prev) ? prev : capabilities.defaultResolution,
    );
  }, [capabilities]);

  // W5.5.1 audit 修 P1-4:capabilities 切 Provider 时 audio 不支持则 reset false
  // 防前 Provider 支持音频用户开了,切到不支持的 Provider 后 UI 停在 ON 误导
  React.useEffect(() => {
    if (!capabilities) return;
    if (!capabilities.supportsAudio) setGenerateAudio(false);
  }, [capabilities]);

  return {
    aspectRatio,
    setAspectRatio,
    durationS,
    setDurationS,
    resolution,
    setResolution,
    generateAudio,
    setGenerateAudio,
  };
}
