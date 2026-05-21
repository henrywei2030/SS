/**
 * next-intl 集成配置 — Phase 2 Next.js 应用使用
 *
 * Phase 1 时这里仅做声明，W2 起 apps/web 的 i18n config 引用此文件。
 */
import { getMessages, type SupportedLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index.js';

/** 给 next-intl `getRequestConfig` 用的 loader */
export async function loadMessagesForRequest(locale: string): Promise<Record<string, unknown>> {
  const normalized = (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as SupportedLocale)
    : DEFAULT_LOCALE;
  return getMessages(normalized);
}

/** 路由层级匹配（/zh-CN/projects /en/projects 等） */
export const I18N_PATH_PREFIX = '/[locale]';

export { SUPPORTED_LOCALES, DEFAULT_LOCALE } from './index.js';
export type { SupportedLocale } from './index.js';
