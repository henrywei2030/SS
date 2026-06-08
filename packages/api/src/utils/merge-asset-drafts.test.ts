/**
 * mergeAssetDrafts 单测(2026-06-08 完整剧本拆解·按集分块跨块合并)。
 * 锁住:同 archetypeKey/name 跨块合并(episodes 并集 + 取更丰富文本 + 保留首个标量),
 *   不同 type 同名不误并,新实体直接累加。
 */
import { describe, expect, it } from 'vitest';

import { mergeAssetDrafts, assetDraftDedupKey, type MergeableDraft } from '@ss/shared';

// 测试用草稿(带额外字段 matchedAssetId / gender,验证泛型透传)
interface Draft extends MergeableDraft {
  matchedAssetId?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  age?: number;
}

const char = (over: Partial<Draft>): Draft => ({ type: 'CHARACTER', name: '陆乘', ...over });

describe('assetDraftDedupKey', () => {
  it('archetypeKey 优先,无则 name;按 type 隔离', () => {
    expect(assetDraftDedupKey({ type: 'CHARACTER', name: '陆乘', archetypeKey: 'lucheng' })).toBe(
      'CHARACTER::lucheng',
    );
    expect(assetDraftDedupKey({ type: 'SCENE', name: '土屋' })).toBe('SCENE::土屋');
  });
});

describe('mergeAssetDrafts', () => {
  it('全新实体 → 全部累加,不合并', () => {
    const acc = mergeAssetDrafts<Draft>(
      [],
      [char({ name: '陆乘', archetypeKey: 'lucheng' }), char({ name: '陈雪', archetypeKey: 'chenxue' })],
    );
    expect(acc).toHaveLength(2);
  });

  it('同 archetypeKey 跨块 → 合并:episodes 并集 + 取更长 description/bio', () => {
    const chunk1 = [
      char({
        archetypeKey: 'lucheng',
        episodes: [1, 2],
        description: '短',
        bio: '小传第一版(较短)',
        alias: ['阿乘'],
      }),
    ];
    const chunk2 = [
      char({
        archetypeKey: 'lucheng',
        episodes: [2, 5],
        description: '更长的形象设定描述文本',
        bio: '小传第二版,明显更长更完整的版本内容',
        alias: ['乘哥'],
      }),
    ];
    const acc = mergeAssetDrafts<Draft>(mergeAssetDrafts<Draft>([], chunk1), chunk2);
    expect(acc).toHaveLength(1);
    expect(acc[0]!.episodes).toEqual([1, 2, 5]); // 并集 + 升序去重
    expect(acc[0]!.description).toBe('更长的形象设定描述文本'); // 取更长
    expect(acc[0]!.bio).toBe('小传第二版,明显更长更完整的版本内容');
    expect(acc[0]!.alias).toEqual(['阿乘', '乘哥']); // 并集
  });

  it('标量字段保留首个非空;首块缺失的由后块补', () => {
    const acc = mergeAssetDrafts<Draft>(
      [char({ archetypeKey: 'lucheng', gender: 'MALE' })], // 首块有 gender,无 age
      [char({ archetypeKey: 'lucheng', gender: 'FEMALE', age: 23 })], // 后块 gender 不同 + 有 age
    );
    expect(acc).toHaveLength(1);
    expect(acc[0]!.gender).toBe('MALE'); // 保留首个
    expect(acc[0]!.age).toBe(23); // 首块缺失 → 后块补上
  });

  it('matchedAssetId 等额外字段透传并保留首个', () => {
    const acc = mergeAssetDrafts<Draft>(
      [char({ archetypeKey: 'lucheng', matchedAssetId: 'asset-1' })],
      [char({ archetypeKey: 'lucheng' })],
    );
    expect(acc[0]!.matchedAssetId).toBe('asset-1');
  });

  it('不同 type 同名 → 不误合并', () => {
    const acc = mergeAssetDrafts<Draft>(
      [{ type: 'CHARACTER', name: '钥匙' }],
      [{ type: 'PROP', name: '钥匙' }],
    );
    expect(acc).toHaveLength(2);
  });

  it('无 archetypeKey 时按 name 合并', () => {
    const acc = mergeAssetDrafts<Draft>(
      [{ type: 'SCENE', name: '土屋', episodes: [1] }],
      [{ type: 'SCENE', name: '土屋', episodes: [3] }],
    );
    expect(acc).toHaveLength(1);
    expect(acc[0]!.episodes).toEqual([1, 3]);
  });

  it('不改原数组(返回新数组)', () => {
    const acc1: Draft[] = [char({ archetypeKey: 'lucheng', episodes: [1] })];
    const acc2 = mergeAssetDrafts<Draft>(acc1, [char({ archetypeKey: 'lucheng', episodes: [2] })]);
    expect(acc1[0]!.episodes).toEqual([1]); // 原数组未变
    expect(acc2[0]!.episodes).toEqual([1, 2]);
  });
});
