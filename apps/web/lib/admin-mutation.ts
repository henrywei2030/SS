/**
 * Admin Mutation Handlers — 4 个 admin manager 共用的 toast + invalidate 模板
 *
 * 三十二收工 R4 小颗粒(R4 大抽 generic AdminTable won't fix 后的折中):
 * 4 个 admin manager(users / styles / prompts / providers)每个 mutation 都写:
 *   onSuccess: () => { toast.success('...'); void utils.xxx.invalidate(); ... }
 *   onError: (e) => toast.error(`xxx 失败:${e.message}`)
 * 这里抽成单 helper,避免重复 + 统一错误提示风格。
 *
 * 用法:
 *   const del = trpc.admin.style.delete.useMutation(
 *     adminMutationHandlers({
 *       successMsg: '已删除',
 *       errorPrefix: '删除失败',
 *       invalidate: [() => utils.admin.style.list.invalidate()],
 *       onSuccess: (data) => { if (selectedId === data.id) setSelectedId(null); },
 *     }),
 *   );
 */
import { toast } from 'sonner';

interface AdminMutationOpts<TData> {
  /** 成功 toast 消息(静态或基于 data 动态) */
  successMsg: string | ((data: TData) => string);
  /** 失败 toast 前缀(默认"操作失败") */
  errorPrefix?: string;
  /** 自动 invalidate 的 trpc queries(传 invalidate 闭包,支持多个) */
  invalidate?: Array<() => Promise<void> | void>;
  /** onSuccess 额外回调(关闭 dialog / 切换 selectedId 等) */
  onSuccess?: (data: TData) => void;
  /** onError 额外回调(默认只 toast,不阻断) */
  onError?: (err: { message: string }) => void;
}

interface MutationHandlers<TData> {
  onSuccess: (data: TData) => void;
  onError: (err: { message: string }) => void;
}

export function adminMutationHandlers<TData>(
  opts: AdminMutationOpts<TData>,
): MutationHandlers<TData> {
  return {
    onSuccess: (data: TData) => {
      const msg =
        typeof opts.successMsg === 'function' ? opts.successMsg(data) : opts.successMsg;
      toast.success(msg);
      if (opts.invalidate) {
        for (const fn of opts.invalidate) {
          const result = fn();
          if (result instanceof Promise) void result;
        }
      }
      opts.onSuccess?.(data);
    },
    onError: (err: { message: string }) => {
      toast.error(`${opts.errorPrefix ?? '操作失败'}:${err.message}`);
      opts.onError?.(err);
    },
  };
}
