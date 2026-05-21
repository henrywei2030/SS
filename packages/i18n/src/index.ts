/**
 * @ss/i18n — 双语切换基础设施
 *
 * 设计：
 *   - 消息源：locales/{locale}/*.json (按业务域分文件)
 *   - 运行时合并：getMessages(locale) → 单 flat object
 *   - 通用 t() 函数（IntlMessageFormat）— 支持复数、性别、日期等 ICU 语法
 *   - W2 Next.js 应用通过 next-intl 集成，复用同一份 locales 数据
 *
 * 用法（Node 端 worker）：
 *   import { t } from '@ss/i18n';
 *   const msg = t('zh-CN', 'modules.workbench.director'); // → "导演"
 *   const greet = t('en', 'time.minuteAgo', { n: 5 });    // → "5 min ago"
 */
import { IntlMessageFormat } from 'intl-messageformat';

import zhCommon from '../locales/zh-CN/common.json' with { type: 'json' };
import zhModules from '../locales/zh-CN/modules.json' with { type: 'json' };
import zhEnums from '../locales/zh-CN/enums.json' with { type: 'json' };
import zhAuth from '../locales/zh-CN/auth.json' with { type: 'json' };

import enCommon from '../locales/en/common.json' with { type: 'json' };
import enModules from '../locales/en/modules.json' with { type: 'json' };
import enEnums from '../locales/en/enums.json' with { type: 'json' };
import enAuth from '../locales/en/auth.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';

export interface MessageCatalog {
  common: typeof zhCommon;
  modules: typeof zhModules;
  enums: typeof zhEnums;
  auth: typeof zhAuth;
}

const CATALOGS: Record<SupportedLocale, MessageCatalog> = {
  'zh-CN': { common: zhCommon, modules: zhModules, enums: zhEnums, auth: zhAuth },
  en: { common: enCommon, modules: enModules, enums: enEnums, auth: enAuth },
};

/** 取整个 locale 的消息合并对象（next-intl 用） */
export function getMessages(locale: SupportedLocale): Record<string, unknown> {
  const cat = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  return {
    ...cat.common,
    modules: cat.modules,
    enums: cat.enums,
    auth: cat.auth,
  };
}

/** 取嵌套 key 对应的字符串模板 */
function getRaw(locale: SupportedLocale, key: string): string {
  const messages = getMessages(locale);
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = messages;
  for (const p of parts) {
    if (current == null || typeof current !== 'object') return key;
    current = current[p];
  }
  return typeof current === 'string' ? current : key;
}

/**
 * 翻译函数（Node 端通用）
 *
 * @example
 *   t('zh-CN', 'modules.workbench.director')        // → "导演"
 *   t('en', 'time.minuteAgo', { n: 5 })             // → "5 min ago"
 *   t('zh-CN', 'enums.shotStatus.GENERATING')       // → "生成中"
 */
export function t(
  locale: SupportedLocale,
  key: string,
  values?: Record<string, string | number | Date>,
): string {
  const raw = getRaw(locale, key);
  if (!values || !raw.includes('{')) return raw;
  try {
    const fmt = new IntlMessageFormat(raw, locale);
    return String(fmt.format(values));
  } catch {
    return raw;
  }
}

/** 给定一个 enum 类型 + 值，找到对应翻译 */
export function tEnum(
  locale: SupportedLocale,
  enumName:
    | 'projectType'
    | 'shotStatus'
    | 'priority'
    | 'assetType'
    | 'assetStatus'
    | 'complianceStatus'
    | 'attemptStatus'
    | 'providerKind'
    | 'mediaKind'
    | 'copyright'
    | 'styleKind',
  value: string,
): string {
  return t(locale, `enums.${enumName}.${value}`);
}

/** 解析用户传入字符串到合法 locale，否则返回默认 */
export function resolveLocale(input: string | null | undefined): SupportedLocale {
  if (!input) return DEFAULT_LOCALE;
  // 简单匹配：zh / zh-CN / zh-Hans → zh-CN；其余 → en
  const lower = input.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}
