import type { CallContext, ProviderInfo } from './types.js';
export interface RecordLedgerOpts {
    ctx: CallContext;
    providerId: string;
    modelId: string;
    action: string;
    inputUnits: number;
    outputUnits: number;
    unitPriceCny: number;
    success: boolean;
}
export declare abstract class BaseProvider {
    abstract readonly info: ProviderInfo;
    /** 记录 Cost Ledger（同步落库） */
    protected recordLedger(opts: RecordLedgerOpts): Promise<void>;
    /** 预算护栏检查（Phase 1 简单实现：仅项目总预算） */
    protected checkBudget(projectId: string | undefined, estimatedCost: number): Promise<void>;
    /** 包装远程调用 — 统一错误转换 */
    protected wrapCallError(e: unknown): never;
}
//# sourceMappingURL=base.d.ts.map