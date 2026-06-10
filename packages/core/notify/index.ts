/**
 * 通知服务 — M0 基建(2026-06-10,蓝图 docs/06 §3 M0)
 *
 * Notification 表(schema 预留已在,零 migration)的唯一写入口 + 可选 webhook 外推。
 * 后续里程碑接入点:M1 成片完成、M4 批量完成/全败推手机、预算预警等。
 *
 * webhook:URL 存 SystemSetting `notify.webhook.url`(留空 = 只落库不外推,admin 可配)。
 * 按 URL 自动适配 payload 形状:飞书自定义机器人 / Bark / 通用 JSON。
 * 外推失败**绝不影响落库与调用方**(5s 超时 + 全捕获,结果只回报状态)。
 */
import type { Prisma, PrismaClient } from '@ss/db';

export const NOTIFY_WEBHOOK_URL_KEY = 'notify.webhook.url';

const WEBHOOK_TIMEOUT_MS = 5_000;

export interface NotifyInput {
  userId: string;
  /** 'job_done' | 'job_failed' | 'budget_warn' | 'system' | ...(schema type 列自由字符串) */
  type: string;
  title: string;
  body?: string;
  payload?: unknown;
}

export type WebhookStatus = 'sent' | 'failed' | 'disabled';

export interface NotifyResult {
  id: string;
  webhook: WebhookStatus;
}

export interface WebhookMessage {
  type: string;
  title: string;
  body?: string;
  payload?: unknown;
}

/**
 * 纯函数(单测用):按 URL 形状构造 webhook 请求体。
 * - 飞书自定义机器人(open.feishu.cn/open-apis/bot):{msg_type:'text', content:{text}}
 * - Bark(api.day.app):{title, body, group}
 * - 其它:通用 JSON {type, title, body, payload}
 */
export function buildWebhookRequest(
  url: string,
  msg: WebhookMessage,
): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* 非法 URL → 走通用形状,fetch 时自然失败并回报 'failed' */
  }

  let payload: unknown;
  if (hostname.endsWith('open.feishu.cn')) {
    const text = msg.body ? `${msg.title}\n${msg.body}` : msg.title;
    payload = { msg_type: 'text', content: { text } };
  } else if (hostname.endsWith('day.app')) {
    payload = { title: msg.title, body: msg.body ?? '', group: 'StarsAlign' };
  } else {
    payload = { type: msg.type, title: msg.title, body: msg.body ?? '', payload: msg.payload };
  }

  return {
    url,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  };
}

/**
 * 内网/保留地址黑名单(六七深审 P1 加固):webhook URL 由 admin 配,默认空,但防被
 * 社工配置成内网地址做 SSRF 探测(job 完成自动 POST)。拦 localhost / 回环 / 内网段 / 云元数据。
 */
export function isBlockedWebhookHost(url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    // URL.hostname 对 IPv6 保留方括号(如 [::1]),strip 掉再比对
    host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return true; // 非法 URL 直接拦
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  // IPv6(必须含冒号才是 IP,否则 fc-api.example.com 这类域名会被 startsWith('fc') 误伤):
  // 回环 ::1 / 链路本地 fe80:: / 唯一本地 fc00::/7
  if (host.includes(':')) {
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
      return true;
    }
  }
  // IPv4 私有/保留段:回环 10/8、172.16-31、192.168、链路本地 169.254(含云元数据 169.254.169.254)
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** 外推 webhook — 5s 超时,任何失败返回 false 不抛(通知外推永不阻断业务) */
export async function sendWebhook(url: string, msg: WebhookMessage): Promise<boolean> {
  if (isBlockedWebhookHost(url)) {
    console.warn(`[notify] webhook 目标是内网/保留地址,已拦截(防 SSRF)`);
    return false;
  }
  try {
    const req = buildWebhookRequest(url, msg);
    const res = await fetch(req.url, {
      ...req.init,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[notify] webhook 响应非 2xx: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[notify] webhook 外推失败:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * 落库 + 可选 webhook 外推。
 * 落库失败正常抛(调用方感知);webhook 失败只降级状态不抛。
 */
export async function notify(
  prisma: Prisma.TransactionClient | PrismaClient,
  input: NotifyInput,
): Promise<NotifyResult> {
  const row = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      payload: input.payload === undefined ? undefined : (input.payload as Prisma.InputJsonValue),
    },
    select: { id: true },
  });

  const url = (
    await prisma.systemSetting.findUnique({
      where: { key: NOTIFY_WEBHOOK_URL_KEY },
      select: { value: true },
    })
  )?.value?.trim();

  if (!url) return { id: row.id, webhook: 'disabled' };

  const ok = await sendWebhook(url, {
    type: input.type,
    title: input.title,
    body: input.body,
    payload: input.payload,
  });
  return { id: row.id, webhook: ok ? 'sent' : 'failed' };
}
