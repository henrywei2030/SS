/**
 * ErrorBanner — admin 页通用错误横幅
 *
 * 三十二收工 R4 小颗粒:
 * users-table / styles-manager / prompts-manager / providers-table 等 4 个 admin 页
 * 各自实现的 `isError && <div className="...">列表加载失败</div>` 横幅抽成单组件。
 *
 * 红色边框 + 半透明背景 + dark mode 兼容(沿用各 manager 原配色)。
 *
 * 用法:
 *   {isError && (
 *     <ErrorBanner
 *       title="用户列表加载失败"
 *       errorMsg={error?.message}
 *       onRetry={() => refetch()}
 *     />
 *   )}
 */
import * as React from 'react';

export interface ErrorBannerProps {
  /** 标题(如"用户列表加载失败") */
  title: string;
  /** 详细错误信息(可选,如 `error?.message`) */
  errorMsg?: string;
  /** 重试按钮回调(可选,有则显示按钮) */
  onRetry?: () => void;
}

export function ErrorBanner({
  title,
  errorMsg,
  onRetry,
}: ErrorBannerProps): React.ReactElement {
  return (
    <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
      <div className="font-semibold">{title}</div>
      {errorMsg && <div className="mt-1 opacity-80">{errorMsg}</div>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-red-500/50 px-2 py-1 text-xs hover:bg-red-500/20"
        >
          重试
        </button>
      )}
    </div>
  );
}
