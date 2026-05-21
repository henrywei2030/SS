import { describe, it, expect } from 'vitest';
import { mergeShots, type MergeableShot } from './merge.js';

const shot = (
  id: string,
  number: string,
  durationS: number,
  positionIdx: number,
  extra: Partial<MergeableShot> = {},
): MergeableShot => ({
  id,
  number,
  durationS,
  positionIdx,
  content: `content ${id}`,
  prompt: `prompt ${id}`,
  ...extra,
});

describe('storyboard/merge', () => {
  it('合并所有镜头到 maxDuration 阈值', () => {
    const shots = [
      shot('a', '1', 2, 0),
      shot('b', '2', 3, 1),
      shot('c', '3', 4, 2),
      shot('d', '4', 5, 3),
    ];
    const { groups } = mergeShots(shots, { maxDurationS: 10 });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.durationS).toBe(9);
    expect(groups[0]?.shots).toHaveLength(3);
    expect(groups[1]?.durationS).toBe(5);
    expect(groups[1]?.shots).toHaveLength(1);
  });

  it('超过 maxDuration 立刻换组', () => {
    const shots = [
      shot('a', '1', 6, 0),
      shot('b', '2', 6, 1),
    ];
    const { groups } = mergeShots(shots, { maxDurationS: 10 });
    expect(groups).toHaveLength(2);
  });

  it('单镜头超过阈值 — 自成一组（不丢弃）', () => {
    const shots = [shot('a', '1', 20, 0)];
    const { groups } = mergeShots(shots, { maxDurationS: 10 });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.durationS).toBe(20);
  });

  it('S 级镜头隔离', () => {
    const shots = [
      shot('a', '1', 2, 0),
      shot('b', '2', 3, 1, { priority: 'S' }),
      shot('c', '3', 2, 2),
    ];
    const { groups } = mergeShots(shots, {
      maxDurationS: 10,
      isolateSPriority: true,
    });
    expect(groups).toHaveLength(3);
    expect(groups[1]?.highestPriority).toBe('S');
    expect(groups[1]?.shots).toHaveLength(1);
  });

  it('场景连续性要求（refAssetIds 必须重叠）', () => {
    const shots = [
      shot('a', '1', 2, 0, { refAssetIds: ['scene-1', 'char-a'] }),
      shot('b', '2', 2, 1, { refAssetIds: ['scene-1', 'char-b'] }),
      shot('c', '3', 2, 2, { refAssetIds: ['scene-2'] }), // 场景跳转
      shot('d', '4', 2, 3, { refAssetIds: ['scene-2'] }),
    ];
    const { groups } = mergeShots(shots, {
      maxDurationS: 10,
      requireSceneContinuity: true,
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.shots.map((s) => s.id)).toEqual(['a', 'b']);
    expect(groups[1]?.shots.map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('按 positionIdx 而非数组顺序排列', () => {
    const shots = [
      shot('c', '3', 2, 2),
      shot('a', '1', 2, 0),
      shot('b', '2', 2, 1),
    ];
    const { groups } = mergeShots(shots, { maxDurationS: 10 });
    expect(groups[0]?.shots.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('合并后镜号正确（"1-3"）', () => {
    const shots = [
      shot('a', '1', 2, 0),
      shot('b', '2', 2, 1),
      shot('c', '3', 2, 2),
    ];
    const { groups } = mergeShots(shots, { maxDurationS: 10 });
    expect(groups[0]?.number).toBe('1-3');
  });

  it('refAssetIds 合并去重', () => {
    const shots = [
      shot('a', '1', 2, 0, { refAssetIds: ['x', 'y'] }),
      shot('b', '2', 2, 1, { refAssetIds: ['y', 'z'] }),
    ];
    const { groups } = mergeShots(shots, { maxDurationS: 10 });
    expect(groups[0]?.refAssetIds.sort()).toEqual(['x', 'y', 'z']);
  });
});
