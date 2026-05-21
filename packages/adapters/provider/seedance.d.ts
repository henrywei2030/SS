import { BaseProvider } from './base.js';
import type { CallContext, IVideoProvider, ProviderInfo, VideoRequest, VideoResult } from './types.js';
export interface SeedanceConfig {
    apiUrl: string;
    apiKey: string;
    defaultModel: string;
    fastModel?: string;
    /** 默认 max_duration（秒），Storyboard 合并阈值用 */
    maxDuration: number;
    /** 单价 CNY/秒 */
    unitPriceCny: number;
    /** 异步任务轮询间隔 ms */
    pollIntervalMs?: number;
    /** 轮询超时 ms */
    pollTimeoutMs?: number;
}
export declare class SeedanceProvider extends BaseProvider implements IVideoProvider {
    private readonly cfg;
    readonly info: ProviderInfo;
    private readonly pollIntervalMs;
    private readonly pollTimeoutMs;
    constructor(cfg: SeedanceConfig);
    estimateCost(req: VideoRequest): number;
    generate(req: VideoRequest, ctx: CallContext): Promise<VideoResult>;
    poll(providerJobId: string): Promise<VideoResult | {
        status: 'pending';
    }>;
    private queryTask;
}
//# sourceMappingURL=seedance.d.ts.map