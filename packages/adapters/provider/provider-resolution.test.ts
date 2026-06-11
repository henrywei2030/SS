/**
 * 七二第六波(用户反馈:happyhorse 掉 MOCK 占位样片):视频 provider 解析回归锁。
 *
 * 背景 — provider 配置各机独立(db:sync 跳过 providers),换机后 happyhorse/wan/kling 的
 * provider 常缺 defaultParams.adapter / endpointStyle,原「双字段全有才认 relay-video」逻辑
 * 把它们静默掉到 MockVideoProvider(用户以为跑真模型,实际占位样片 + 错单价)。
 * 本测试锁住:已知中转站视频家族关键字 → 真 SeedanceProvider;无关键字无 adapter → 仍 MOCK(不误伤)。
 */
import { describe, expect, it } from 'vitest';

import { constructVideoProvider, SeedanceProvider } from './index.js';

type Cfg = Parameters<typeof constructVideoProvider>[0];

function baseCfg(overrides: Partial<Cfg>): Cfg {
  return {
    providerId: 'test-provider',
    apiUrl: '',
    apiKey: 'tok',
    unitPriceCny: 1.6,
    unitName: '秒',
    defaultParams: {},
    maxConcurrent: 2,
    cacheKey: 'k',
    ...overrides,
  };
}

describe('视频 provider 解析 · relay-video 防 MOCK(七二第六波)', () => {
  it('happyhorse 缺 adapter/endpointStyle(各机漂移)→ 按关键字推断为真 relay-video,不掉 MOCK', () => {
    const p = constructVideoProvider(
      baseCfg({
        providerId: 'moyu-happyhorse-1-0-r2v',
        defaultParams: { defaultModel: 'happyhorse-1.0-r2v' },
      }),
    );
    expect(p).toBeInstanceOf(SeedanceProvider);
  });

  it('wan / kling 同样按关键字推断(modelId 或 providerId 命中)', () => {
    expect(
      constructVideoProvider(baseCfg({ providerId: 'x', defaultParams: { defaultModel: 'wan2.6-i2v' } })),
    ).toBeInstanceOf(SeedanceProvider);
    expect(
      constructVideoProvider(baseCfg({ providerId: 'relay-kling-v2-6', defaultParams: {} })),
    ).toBeInstanceOf(SeedanceProvider);
  });

  it('显式 adapter=relay-video 即认(endpointStyle 缺省也强制走 relay)', () => {
    expect(
      constructVideoProvider(
        baseCfg({ providerId: 'custom', defaultParams: { adapter: 'relay-video', defaultModel: 'mystery' } }),
      ),
    ).toBeInstanceOf(SeedanceProvider);
  });

  it('seedance 显式仍走真 provider', () => {
    expect(
      constructVideoProvider(baseCfg({ providerId: 'seedance-2.0-fast', defaultParams: {} })),
    ).toBeInstanceOf(SeedanceProvider);
  });

  it('无关键字 + 无 adapter → 仍 MOCK(不误伤未知模型)', () => {
    const p = constructVideoProvider(
      baseCfg({ providerId: 'some-unknown-vid', defaultParams: { defaultModel: 'unknown-model' } }),
    );
    expect(p).not.toBeInstanceOf(SeedanceProvider);
  });

  // 七二第六波(内部诊断实证):r2v/i2v 缺参考图 → generate 前置硬门,不白提交 moyu 任务
  it('r2v/i2v 模型缺参考图 → generate 前置硬门清晰报错(不提交 moyu)', async () => {
    const r2v = constructVideoProvider(
      baseCfg({ providerId: 'moyu-happyhorse-1-0-r2v', defaultParams: { defaultModel: 'happyhorse-1.0-r2v' } }),
    );
    await expect(
      r2v.generate({ prompt: 'x', durationS: 5, aspectRatio: '9:16' } as never, { userId: 't' } as never),
    ).rejects.toThrow(/参考图/);

    const i2v = constructVideoProvider(
      baseCfg({ providerId: 'moyu-wan2-6-i2v', defaultParams: { defaultModel: 'wan2.6-i2v' } }),
    );
    await expect(
      i2v.generate({ prompt: 'x', durationS: 5, aspectRatio: '9:16' } as never, { userId: 't' } as never),
    ).rejects.toThrow(/参考图/);
  });
});
