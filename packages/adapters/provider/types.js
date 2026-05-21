/**
 * ProviderAdapter — AI 模型调用抽象
 *
 * 设计要点：
 *   - 所有 Provider 实现共同的 BaseProvider，自带 Cost Ledger 记账中间件
 *   - 业务层只调 generate(req)，不感知 provider 细节
 *   - Phase 2 通过 LiteLLM 接入更多模型，无需改业务代码
 */
export {};
//# sourceMappingURL=types.js.map