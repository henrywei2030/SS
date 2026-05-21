import { describe, it, expect } from 'vitest';
import { t, tEnum, resolveLocale, getMessages, SUPPORTED_LOCALES } from './index.js';

describe('i18n / t()', () => {
  it('返回中文 key 翻译', () => {
    expect(t('zh-CN', 'modules.workbench.director')).toBe('导演');
    expect(t('zh-CN', 'actions.create')).toBe('创建');
  });

  it('返回英文 key 翻译', () => {
    expect(t('en', 'modules.workbench.director')).toBe('Director');
    expect(t('en', 'actions.create')).toBe('Create');
  });

  it('ICU 复数处理', () => {
    expect(t('en', 'time.minuteAgo', { n: 1 })).toBe('1 min ago');
    expect(t('en', 'time.minuteAgo', { n: 5 })).toBe('5 min ago');
    expect(t('zh-CN', 'time.minuteAgo', { n: 5 })).toBe('5 分钟前');
  });

  it('ICU 变量替换', () => {
    expect(t('zh-CN', 'missionControl.completedShots', { completed: 13, total: 956 })).toBe(
      '13 / 956 个镜头已完成视频',
    );
    expect(t('en', 'missionControl.completedShots', { completed: 13, total: 956 })).toBe(
      '13 / 956 shots completed',
    );
  });

  it('找不到 key 时返回 key 本身（不崩）', () => {
    expect(t('zh-CN', 'nonexistent.path.here')).toBe('nonexistent.path.here');
  });

  it('tEnum 翻译枚举值', () => {
    expect(tEnum('zh-CN', 'shotStatus', 'GENERATING')).toBe('生成中');
    expect(tEnum('en', 'shotStatus', 'GENERATING')).toBe('Generating');
    expect(tEnum('zh-CN', 'projectType', 'AI_REAL')).toBe('AI 真人');
    expect(tEnum('en', 'projectType', 'AI_REAL')).toBe('AI Live-action');
  });

  it('resolveLocale 容错', () => {
    expect(resolveLocale('zh')).toBe('zh-CN');
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
    expect(resolveLocale('zh-Hans')).toBe('zh-CN');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('fr')).toBe('zh-CN'); // 落回默认
    expect(resolveLocale(null)).toBe('zh-CN');
    expect(resolveLocale(undefined)).toBe('zh-CN');
  });

  it('getMessages 合并所有 namespace', () => {
    const zh = getMessages('zh-CN');
    const en = getMessages('en');
    expect(zh).toHaveProperty('app');
    expect(zh).toHaveProperty('modules');
    expect(zh).toHaveProperty('enums');
    expect(zh).toHaveProperty('auth');
    expect(en).toHaveProperty('app');
  });

  it('SUPPORTED_LOCALES 列表正确', () => {
    expect(SUPPORTED_LOCALES).toContain('zh-CN');
    expect(SUPPORTED_LOCALES).toContain('en');
  });
});
