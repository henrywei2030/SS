/**
 * Provider 注册中心
 *
 * 用法：
 *   const provider = getVideoProvider('seedance-2.0');
 *   const result = await provider.generate(req, ctx);
 *
 * Phase 2 通过 LiteLLM 接入更多模型时，新增一个文件 + register() 即可。
 */
export * from './types.js';
export { BaseProvider } from './base.js';
export { SeedanceProvider } from './seedance.js';
import type { IVideoProvider, IImageProvider, ITextProvider, IComplianceProvider } from './types.js';
/** 从环境变量初始化默认 Provider（Phase 1: Seedance） */
export declare function initProviders(): void;
export declare function getVideoProvider(id: string): IVideoProvider;
export declare function getImageProvider(id: string): IImageProvider;
export declare function getTextProvider(id: string): ITextProvider;
export declare function getComplianceProvider(id: string): IComplianceProvider;
/** 调试用 — 列出所有已注册 provider */
export declare function listProviders(): {
    kind: string;
    id: string;
}[];
/** 测试时重置 */
export declare function resetProviders(): void;
//# sourceMappingURL=index.d.ts.map