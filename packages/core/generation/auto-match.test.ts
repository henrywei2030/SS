import { describe, it, expect } from 'vitest';
import { autoMatchAssets, injectMentions, type MatchableAsset } from './auto-match.js';

const asset = (
  id: string,
  type: 'CHARACTER' | 'SCENE' | 'PROP',
  name: string,
  alias: string[] = [],
): MatchableAsset => ({ id, type, name, alias });

describe('generation/auto-match', () => {
  const assets: MatchableAsset[] = [
    asset('c1', 'CHARACTER', '陆萌萌', ['萌萌']),
    asset('c2', 'CHARACTER', '陆乘', ['乘哥']),
    asset('c3', 'CHARACTER', '王大富'),
    asset('p1', 'PROP', '协议', ['土地承包转让协议']),
    asset('p2', 'PROP', '太息灵泉水玉瓶', ['灵泉水', '玉瓶']),
    asset('s1', 'SCENE', '陆秉家破土屋'),
  ];

  it('精确匹配人物名', () => {
    const r = autoMatchAssets('陆萌萌走进了陆秉家破土屋', assets);
    expect(r.map((x) => x.assetName)).toEqual(['陆萌萌', '陆秉家破土屋']);
  });

  it('别名匹配', () => {
    const r = autoMatchAssets('萌萌喝了灵泉水', assets);
    expect(r.map((x) => x.matchedTerm)).toEqual(['萌萌', '灵泉水']);
    expect(r[0]?.assetName).toBe('陆萌萌'); // 别名指向主名
    expect(r[1]?.assetName).toBe('太息灵泉水玉瓶');
  });

  it('长名优先：避免"陆"误中"陆萌萌"', () => {
    // 即使有 "陆" 单字别名也不会与 "陆萌萌" 冲突
    const r = autoMatchAssets('陆萌萌看了陆乘一眼', assets);
    expect(r).toHaveLength(2);
    expect(r[0]?.assetName).toBe('陆萌萌');
    expect(r[1]?.assetName).toBe('陆乘');
  });

  it('同一资产同一别名多次出现只记一次', () => {
    const r = autoMatchAssets('陆萌萌！陆萌萌！陆萌萌！', assets);
    const luMengCount = r.filter((x) => x.assetId === 'c1').length;
    expect(luMengCount).toBe(1);
  });

  it('OS / 旁白识别为 VOICE_ONLY', () => {
    const r = autoMatchAssets('陆萌萌（OS）：哥，你怎么了？', assets);
    const lu = r.find((x) => x.assetId === 'c1');
    expect(lu?.refKind).toBe('VOICE_ONLY');
  });

  it('默认识别为 VISIBLE', () => {
    const r = autoMatchAssets('陆萌萌站起来', assets);
    expect(r[0]?.refKind).toBe('VISIBLE');
  });

  it('injectMentions 替换占位符', () => {
    const text = '陆萌萌抓起协议';
    const matches = autoMatchAssets(text, assets);
    const injected = injectMentions(text, matches);
    expect(injected).toBe('@角色[陆萌萌]抓起@道具[协议]');
  });

  it('空文本 / 空资产库 返回空', () => {
    expect(autoMatchAssets('', assets)).toEqual([]);
    expect(autoMatchAssets('陆萌萌', [])).toEqual([]);
  });

  it('返回位置升序', () => {
    const r = autoMatchAssets('王大富对陆乘说：陆萌萌不见了', assets);
    expect(r.map((x) => x.position)).toEqual([...r.map((x) => x.position)].sort((a, b) => a - b));
  });
});
