import * as React from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@ss/api';

import { cn } from '@/lib/utils';

export type AssetDetail = inferRouterOutputs<AppRouter>['asset']['get'];

// ---------------------------------------------------------------------------
// 类型 + 槽位定义
// ---------------------------------------------------------------------------

export type AssetType = 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE';
export type Slot =
  | 'portrait'
  | 'three_view'
  | 'scene_main'
  | 'scene_front'
  | 'scene_left'
  | 'scene_right'
  | 'scene_back'
  | 'panorama'
  | 'main';

export const SLOTS_BY_TYPE: Record<AssetType, Array<{ slot: Slot; label: string; aspectClass: string }>> = {
  // 七二第九波(用户②定调):人物下线独立「三视图」窗口,合并为单一「主体形象」—
  //   一张 16:9 横版图同框呈现正面立绘 + 三视图(character turnaround / model sheet),
  //   既当 portrait 主图、又是下游视频的身份级参考(threeViewMediaId 字段保留,旧数据兜底,
  //   不写破坏性 migration;照场景「下线主视角」先例)。
  CHARACTER: [
    { slot: 'portrait', label: '主体形象 (正面+三视图同框 · 16:9)', aspectClass: 'aspect-[16/9]' },
  ],
  // 七二第八波(用户定调):场景下线「主视角」窗口,九宫格为主 —
  //   九宫格(threeViewMediaId,16:9)= 场景主资产,一次性直接生成(文生图,不再以主视角图生图);
  //   360° 全景(panoramaMediaId)= 以九宫格为参考图生图。
  //   主视角(sceneMainMediaId)及正面/左侧/右侧/背面单视角槽位全部下线
  //   (DB 字段保留,旧数据不丢,UI 不再展示/不参与生成与编译流程)。
  SCENE: [
    { slot: 'three_view', label: '九宫格视图 (9 角度合一)', aspectClass: 'aspect-[16/9]' },
    { slot: 'panorama', label: '360° 全景', aspectClass: 'aspect-[2/1]' },
  ],
  PROP: [{ slot: 'main', label: '主图', aspectClass: 'aspect-square' }],
  STYLE_REFERENCE: [{ slot: 'main', label: '风格参考图', aspectClass: 'aspect-square' }],
};

export const SLOT_FIELD: Record<Slot, string> = {
  portrait: 'portraitMediaId',
  three_view: 'threeViewMediaId',
  scene_main: 'sceneMainMediaId',
  scene_front: 'sceneFrontMediaId',
  scene_left: 'sceneLeftMediaId',
  scene_right: 'sceneRightMediaId',
  scene_back: 'sceneBackMediaId',
  panorama: 'panoramaMediaId',
  main: 'mainMediaId',
};

export const CHARACTER_ROLES = [
  '主演-男主',
  '主演-女主',
  '主演-反派',
  '配角-正派',
  '配角-反派',
  '配角-中性',
  '群演',
] as const;

export const RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3', '2:1'] as const;
export const SIZES = ['1K (1024)', '2K (2048)', '4K (4096)'] as const;

export function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--color-muted-foreground))]">
        {label}
      </span>
      <span className={cn('text-[11px]', mono && 'font-mono')}>{value}</span>
    </div>
  );
}
