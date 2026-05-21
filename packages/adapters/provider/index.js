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
import { SeedanceProvider } from './seedance.js';
const registry = {
    video: new Map(),
    image: new Map(),
    text: new Map(),
    compliance: new Map(),
};
let _initialized = false;
/** 从环境变量初始化默认 Provider（Phase 1: Seedance） */
export function initProviders() {
    if (_initialized)
        return;
    // ---------- Seedance ----------
    const seedanceKey = process.env.SEEDANCE_API_KEY;
    if (seedanceKey) {
        const defaultModel = process.env.SEEDANCE_DEFAULT_MODEL ?? 'seedance-2.0';
        const fastModel = process.env.SEEDANCE_FAST_MODEL ?? 'seedance-2.0-fast';
        const seedance = new SeedanceProvider({
            apiUrl: process.env.SEEDANCE_API_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
            apiKey: seedanceKey,
            defaultModel,
            fastModel,
            maxDuration: Number(process.env.SEEDANCE_MAX_DURATION_S ?? '10'),
            unitPriceCny: 1.0,
        });
        registry.video.set(defaultModel, seedance);
        registry.video.set(fastModel, seedance);
    }
    else {
        console.warn('[providers] SEEDANCE_API_KEY not set — Seedance disabled');
    }
    // Phase 2: 在此注册 nano-banana, gpt-image, doubao, anthropic, volcengine-compliance ...
    _initialized = true;
}
export function getVideoProvider(id) {
    if (!_initialized)
        initProviders();
    const p = registry.video.get(id);
    if (!p)
        throw new Error(`Video provider not registered: ${id}`);
    return p;
}
export function getImageProvider(id) {
    if (!_initialized)
        initProviders();
    const p = registry.image.get(id);
    if (!p)
        throw new Error(`Image provider not registered: ${id}`);
    return p;
}
export function getTextProvider(id) {
    if (!_initialized)
        initProviders();
    const p = registry.text.get(id);
    if (!p)
        throw new Error(`Text provider not registered: ${id}`);
    return p;
}
export function getComplianceProvider(id) {
    if (!_initialized)
        initProviders();
    const p = registry.compliance.get(id);
    if (!p)
        throw new Error(`Compliance provider not registered: ${id}`);
    return p;
}
/** 调试用 — 列出所有已注册 provider */
export function listProviders() {
    if (!_initialized)
        initProviders();
    const out = [];
    for (const [id] of registry.video)
        out.push({ kind: 'video', id });
    for (const [id] of registry.image)
        out.push({ kind: 'image', id });
    for (const [id] of registry.text)
        out.push({ kind: 'text', id });
    for (const [id] of registry.compliance)
        out.push({ kind: 'compliance', id });
    return out;
}
/** 测试时重置 */
export function resetProviders() {
    registry.video.clear();
    registry.image.clear();
    registry.text.clear();
    registry.compliance.clear();
    _initialized = false;
}
//# sourceMappingURL=index.js.map