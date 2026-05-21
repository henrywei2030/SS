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

export class NotFoundError extends SsError {
  constructor(resource: string, id?: string) {
    super('NOT_FOUND', `${resource}${id ? ` ${id}` : ''} not found`, 404);
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
