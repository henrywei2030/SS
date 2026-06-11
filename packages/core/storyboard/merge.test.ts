import { describe, it, expect } from 'vitest';
import { buildGroupShotLine, mergeShots, type MergeableShot } from './merge.js';

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

  it('requireSameScene:仅同一 sceneId 相邻镜头合并,跨场景强制开新组', () => {
    const shots = [
      shot('a', '1', 2, 0, { sceneId: 'sc1' }),
      shot('b', '2', 2, 1, { sceneId: 'sc1' }),
      shot('c', '3', 2, 2, { sceneId: 'sc2' }), // 换场景
      shot('d', '4', 2, 3, { sceneId: 'sc2' }),
    ];
    // maxDurationS 设大,确保只有「场景边界」触发分组(隔离场景规则)
    const { groups } = mergeShots(shots, { maxDurationS: 100, requireSameScene: true });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.shots.map((s) => s.id)).toEqual(['a', 'b']);
    expect(groups[1]?.shots.map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('requireSameScene + maxDuration:同场景内按时长封顶分组,跨场景再切', () => {
    const shots = [
      shot('a', '1', 4, 0, { sceneId: 'sc1' }),
      shot('b', '2', 4, 1, { sceneId: 'sc1' }), // a+b=8 ≤10 同组
      shot('c', '3', 4, 2, { sceneId: 'sc1' }), // +c=12>10 → 同场景内开新组
      shot('d', '4', 3, 3, { sceneId: 'sc2' }), // 换场景 → 开新组
      shot('e', '5', 3, 4, { sceneId: 'sc2' }), // d+e=6 ≤10 同组
    ];
    const { groups } = mergeShots(shots, { maxDurationS: 10, requireSameScene: true });
    expect(groups.map((g) => g.shots.map((s) => s.id))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d', 'e'],
    ]);
  });

  it('requireSameScene:无 sceneId(未分场)视为同一组,可彼此合并', () => {
    const shots = [shot('a', '1', 2, 0), shot('b', '2', 2, 1)];
    const { groups } = mergeShots(shots, { maxDurationS: 10, requireSameScene: true });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.shots.map((s) => s.id)).toEqual(['a', 'b']);
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

  it('合并提示词:段落间用空行,不含 --- 分隔符', () => {
    const shots = [shot('a', '1', 2, 0), shot('b', '2', 2, 1)];
    const { groups } = mergeShots(shots, { maxDurationS: 10 });
    expect(groups[0]?.mergedPrompt).not.toContain('---');
    expect(groups[0]?.mergedPrompt).toContain('prompt a');
    expect(groups[0]?.mergedPrompt).toContain('prompt b');
  });

  // ----- H0 捡漏(docs/07 §4.2):buildGroupShotLine 全维拼接 -----
  describe('buildGroupShotLine', () => {
    it('全维齐:framing/angle/movement/lighting/durationS 进标题,sound 行尾括注', () => {
      const line = buildGroupShotLine(
        {
          framing: '全景',
          angle: '俯视30°',
          movement: '固定',
          lighting: '低调侧光',
          sound: '雨声渐强',
          durationS: 3,
          prompt: '林凡站在天台边缘',
        },
        0,
        3,
      );
      expect(line).toBe('[1/3] 全景 俯视30° 固定 低调侧光 3s 林凡站在天台边缘(音效:雨声渐强)');
    });

    it('缺维不留空洞:只有 framing 时与旧格式兼容', () => {
      const line = buildGroupShotLine(
        { framing: '特写', durationS: 2, prompt: '手在颤抖' },
        1,
        2,
      );
      expect(line).toBe('[2/2] 特写 2s 手在颤抖');
    });

    it('小数时长保留一位,无 sound 不出现括注', () => {
      const line = buildGroupShotLine(
        { movement: '推', durationS: 7.5, prompt: 'p' },
        0,
        1,
      );
      expect(line).toBe('[1/1] 推 7.5s p');
      expect(line).not.toContain('音效');
    });

    it('mergePrompts 经由共享行构造:四维 + 音效进 mergedPrompt', () => {
      const shots = [
        shot('a', '1', 2, 0, { movement: '跟', lighting: '逆光', sound: '脚步声' }),
        shot('b', '2', 2, 1),
      ];
      const { groups } = mergeShots(shots, { maxDurationS: 10 });
      expect(groups[0]?.mergedPrompt).toContain('跟 逆光 2s');
      expect(groups[0]?.mergedPrompt).toContain('(音效:脚步声)');
    });
  });
});
