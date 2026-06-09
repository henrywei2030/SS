/**
 * 桌面端首次激活 —— 共享密钥(最简方案)。
 *
 * - 仅桌面态(`SS_DESKTOP=1`,由 desktop-bootstrap 注入)启用;web/云端 SS_DESKTOP 未设 → 永不拦截。
 * - 校验:输入密钥的 sha256 与内置 ACTIVATION_KEY_SHA256 比对。**明文不入二进制,只存哈希**。
 * - 激活状态:per-机器存 DB SystemSetting `desktop.activatedAt`(各机独立 DB → 用同一密钥逐台激活一次)。
 *
 * 🔑 改密钥:跑
 *   node -e "console.log(require('crypto').createHash('sha256').update('你的新密钥').digest('hex'))"
 *   把输出替换下面 ACTIVATION_KEY_SHA256,重新打包桌面包即可(无需改别处)。
 */
import { createHash } from 'node:crypto';

import { redirect } from 'next/navigation';

import { prisma } from '@ss/db';
import { DEFAULT_LOCALE } from '@ss/i18n';

// sha256('SSALIGN-JHMY-7MET-S1DY') —— 初始密钥,可按上方说明更换
const ACTIVATION_KEY_SHA256 =
  '3597425ecf562938cef969ca5c6ba2c3e6afa15e363c7a67380c90aa8cdb6287';

const ACTIVATION_SETTING_KEY = 'desktop.activatedAt';

/** 桌面态才需激活(web/云端 SS_DESKTOP 未设 → false,行为零变化) */
export function isDesktopActivationRequired(): boolean {
  return process.env.SS_DESKTOP === '1';
}

/** 校验输入密钥(去首尾空白,大小写敏感) */
export function verifyActivationKey(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) return false;
  return createHash('sha256').update(normalized).digest('hex') === ACTIVATION_KEY_SHA256;
}

/** 本机是否已激活(读 DB SystemSetting) */
export async function isActivated(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: ACTIVATION_SETTING_KEY },
    select: { value: true },
  });
  return !!row?.value;
}

/** 记录本机已激活(幂等 upsert,存激活时间) */
export async function markActivated(): Promise<void> {
  const at = new Date().toISOString();
  await prisma.systemSetting.upsert({
    where: { key: ACTIVATION_SETTING_KEY },
    update: { value: at },
    create: {
      key: ACTIVATION_SETTING_KEY,
      value: at,
      category: 'security',
      description: '桌面端首次激活时间(共享密钥激活;此项存在即视为本机已激活)',
    },
  });
}

/** Server Component 守卫:桌面态且未激活 → 跳 /[locale]/activate */
export async function requireActivation(locale: string = DEFAULT_LOCALE): Promise<void> {
  if (!isDesktopActivationRequired()) return;
  if (await isActivated()) return;
  redirect(`/${locale}/activate`);
}
