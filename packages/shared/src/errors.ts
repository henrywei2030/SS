/**
 * 统一错误类型
 */
export class SsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 500,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SsError';
  }
}

export class ForbiddenError extends SsError {
  constructor(reason = 'forbidden') {
    super('FORBIDDEN', reason, 403);
  }
}

export class ValidationError extends SsError {
  constructor(message: string, public readonly issues?: unknown) {
    super('VALIDATION', message, 400);
  }
}

export class BudgetExceededError extends SsError {
  constructor(scope: string, limit: number, current: number) {
    super(
      'BUDGET_EXCEEDED',
      `Budget exceeded for ${scope}: ${current.toFixed(2)} / ${limit.toFixed(2)} CNY`,
      402,
    );
  }
}

export class ProviderError extends SsError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super('PROVIDER_ERROR', `[${providerId}] ${message}`, 502, cause);
  }
}

export class ComplianceError extends SsError {
  constructor(reason: string) {
    super('COMPLIANCE_REJECTED', reason, 451);
  }
}

/**
 * 第 18 轮 audit P1:对外暴露 errorMsg 前脱敏
 *
 * Why:真接 Seedance/Claude 等 Provider 后,Error.message 可能包含 API URL / token / 内部 path,
 *      Worker 直接 SSE 推给前端 + 入库 attempt.errorMsg 会泄漏。
 * What:去 URL / 长 hex / 长 base64 / 深 path,截断到 maxLen。
 * 原始 error 在 worker console.error 仍可见,开发者 debug 用日志。
 */
export function sanitizeErrorMsg(err: unknown, maxLen = 200): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/https?:\/\/[^\s]+/g, '[URL]')
    // 漏洞审查加固:补 token 类盲区 — 原 4 条规则漏带连字符 key(sk-proj-…)/ JWT / 裸 IP:port
    //   (这些含 - _ . 会打断 base64 规则的连续段;JWT 每段 <40 字符也漏网)
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, '[JWT]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [TOKEN]')
    .replace(/\b(?:sk|pk|rk|ak|tok|secret|api[_-]?key)[-_][A-Za-z0-9_-]{8,}/gi, '[KEY]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[HASH]')
    .replace(/\b[A-Za-z0-9+/=]{40,}={0,2}\b/g, '[B64]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, '[IP]')
    .replace(/(\/[^\s/]+){3,}/g, '[PATH]')
    .slice(0, maxLen)
    .trim();
}
