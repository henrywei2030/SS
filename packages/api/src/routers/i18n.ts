/**
 * i18n Router — 公开访问的多语言消息（供前端 next-intl 使用）
 */
import { z } from 'zod';

import { getMessages, SUPPORTED_LOCALES, type SupportedLocale } from '@ss/i18n';

import { router, publicProcedure } from '../trpc.js';

export const i18nRouter = router({
  messages: publicProcedure
    .input(
      z.object({
        locale: z.enum(SUPPORTED_LOCALES as unknown as [SupportedLocale, ...SupportedLocale[]]),
      }),
    )
    .query(({ input }) => {
      return getMessages(input.locale);
    }),

  supported: publicProcedure.query(() => {
    return [...SUPPORTED_LOCALES];
  }),
});
