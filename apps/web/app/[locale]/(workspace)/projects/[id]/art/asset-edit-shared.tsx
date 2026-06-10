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
  CHARACTER: [
    { slot: 'portrait', label: '已确认人物形象 (9:16)', aspectClass: 'aspect-[9/16]' },
    { slot: 'three_view', label: '已确认三视图 (16:9)', aspectClass: 'aspect-[16/9]' },
  ],
  // 六八(用户定调):场景只留 主视角 / 九宫格 / 全景 三窗口 —
  //   九宫格 = 一张图含 9 个角度(复用 threeViewMediaId 字段,人物三视图同字段不同语义);
  //   正面/左侧/右侧/背面 四个单视角槽位下线(DB 字段保留,旧数据不丢,UI 不再展示)。
  //   参考链:主视角确认 → 九宫格图生图;九宫格确认 → 全景图生图(逻辑同人物 形象→三视图)。
  SCENE: [
    { slot: 'scene_main', label: '主视角', aspectClass: 'aspect-[16/9]' },
    { slot: 'three_view', label: '九宫格视图 (9 角度合一)', aspectClass: 'aspect-square' },
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
