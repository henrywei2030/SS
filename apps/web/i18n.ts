/**
 * next-intl 配置入口 — 由 next.config.ts 引用
 */
import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { loadMessagesForRequest, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@ss/i18n/next-intl';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    if (!locale) {
      locale = DEFAULT_LOCALE;
    } else {
      notFound();
    }
  }
  // next-intl RequestConfig.messages 严格类型为 AbstractIntlMessages（嵌套 string）
  // 我们的 loadMessagesForRequest 返回 Record<string, unknown>（含嵌套对象），
  // 实际形状兼容，仅 TS 推断收窄。这里通过 type assertion 抹平。
  const messages = (await loadMessagesForRequest(locale)) as Record<
    string,
    unknown
  > as Record<string, never>;
  return {
    locale,
    messages,
    timeZone: 'Asia/Shanghai',
  };
});
