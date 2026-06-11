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
  /** M2′:系统默认有声开关(setting shot.video.generateAudio.default,服务端下发) */
  defaultGenerateAudio?: boolean;
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

  // 七二第九波(用户诉求:预览跟随项目尺寸 + 改项目后自动调整):
  //   不再「一次性初始化」—— 改为「跟随 project.aspect 的变化」。记录上次见过的
  //   project.aspect,仅当它真变化时(含首次 undefined→值)才回写预览 aspectRatio;
  //   capabilities 切换(换 provider)时只做「当前值不被支持就 fallback」。
  //   收益:① 首次跟项目;② 用户在预览手选的比例,在同一项目 aspect 下不被 provider
  //   refetch 冲掉(projectChanged=false 只走 fallback 分支,functional setter 保留手选);
  //   ③ 用户改了项目 aspect → getGroupDetail 失效刷新带来新值 → projectChanged=true → 预览自动调整。
  const lastProjectAspectRef = React.useRef<AspectRatio | undefined>(undefined);
  React.useEffect(() => {
    if (!capabilities) return;
    const supported = capabilities.supportedAspectRatios;
    const projectAspect = groupDetail?.project?.aspect as AspectRatio | undefined;
    if (projectAspect !== undefined && projectAspect !== lastProjectAspectRef.current) {
      lastProjectAspectRef.current = projectAspect;
      const next = supported.includes(projectAspect) ? projectAspect : (supported[0] ?? projectAspect);
      if (next) setAspectRatio(next);
      return;
    }
    // 换 provider:当前选择若不被新 provider 支持,回退到首个支持项(不动项目跟随)
    setAspectRatio((prev) => (supported.includes(prev) ? prev : (supported[0] ?? prev)));
  }, [capabilities, groupDetail]);

  // W5.5.1:capabilities 加载后同步分辨率。
  // 七二第九波(用户①:happyhorse 默认 1080p):provider 的 defaultResolution 变化时(切 provider /
  //   首次)主动跟随到该 provider 推荐默认 —— 原逻辑只在「当前值不被支持」时才 fallback,而 720p
  //   恒被支持 → happyhorse 的 1080p 默认永远生效不了。同 provider 下 default 不变时只保
  //   「当前值不被支持就回退」,不冲掉用户手选。
  const lastDefaultResolutionRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!capabilities) return;
    const def = capabilities.defaultResolution;
    if (def !== lastDefaultResolutionRef.current) {
      lastDefaultResolutionRef.current = def;
      if (capabilities.supportedResolutions.includes(def)) {
        setResolution(def);
        return;
      }
    }
    setResolution((prev) =>
      capabilities.supportedResolutions.includes(prev) ? prev : capabilities.defaultResolution,
    );
  }, [capabilities]);

  // M2′:首次 capabilities 到达时,音频开关初始化为系统默认(setting 下发);
  // 之后只在 Provider 不支持时强制 reset false(原 P1-4 行为保留),用户手选不被覆盖
  const audioInitializedRef = React.useRef(false);
  React.useEffect(() => {
    if (!capabilities) return;
    if (!capabilities.supportsAudio) {
      setGenerateAudio(false);
      return;
    }
    if (!audioInitializedRef.current) {
      setGenerateAudio(capabilities.defaultGenerateAudio ?? true);
      audioInitializedRef.current = true;
    }
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
