/**
 * 第 20 轮 audit P1:tRPC error toast 提取 requestId
 *
 * Why:server-side(第 19 轮)已在 errorFormatter 透传 `requestId` 到 error.data,
 *     但前端 components 各自 toast 都只显示 e.message,丢了 requestId。
 *     用户报 bug 时拿不到 requestId,运维无法 grep 日志全链路追溯。
 *
 * How to apply:components 内 mutation onError / query error 用 showTrpcError 替代 toast.error:
 *   onError: (err) => showTrpcError(err, '资产创建失败')
 *
 * 显示格式:`<prefix>: <err.message> · req=<requestId 后 8 位>`
 * 后 8 位足够 grep 唯一(UUID 全长 36 字符显示太长,影响 UX)
 */
import { toast } from 'sonner';

interface TRPCLikeError {
  message: string;
  data?: {
    requestId?: string;
    ssCode?: string;
    zodIssues?: unknown;
  } | null;
}

export function extractRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const data = (error as TRPCLikeError).data;
  if (!data) return undefined;
  const id = data.requestId;
  if (typeof id !== 'string') return undefined;
  return id;
}

export function formatRequestIdSuffix(requestId: string | undefined): string {
  if (!requestId) return '';
  // 显示后 8 位,够运维 grep 唯一,UX 不过长
  return ` · req=${requestId.slice(-8)}`;
}

/**
 * 统一 tRPC 错误 toast — 自动附加 requestId 后缀
 *
 * @param error tRPC mutation/query 错误对象
 * @param prefix 可选业务前缀(如 "资产创建失败"),无则用 err.message
 * @param description 可选副标题(多行说明)
 */
export function showTrpcError(error: unknown, prefix?: string, description?: string): void {
  const err = error as TRPCLikeError;
  const requestId = extractRequestId(err);
  const main = prefix ?? err?.message ?? '操作失败';
  const suffix = formatRequestIdSuffix(requestId);
  toast.error(main + suffix, description ? { description } : undefined);
}

/**
 * 401 / 403 触发时,可考虑跳转 /login(由 caller 自决,不强制)
 * 当前留 hook 供 Phase 2 全局 error interceptor 用
 */
export function isAuthError(error: unknown): boolean {
  const err = error as TRPCLikeError;
  const code = err?.data?.ssCode;
  return code === 'FORBIDDEN' || code === 'UNAUTHORIZED';
}
