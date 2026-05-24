/**
 * URL 安全校验 — 防 SSRF
 *
 * 第 23 轮 audit P1:admin.provider.create 接受任意 apiUrl 时,
 * 攻击者可填 internal IP(10.x / 172.16-31.x / 192.168.x / metadata 169.254.169.254)
 * 让 server 替他扫内网或读云元数据(AWS/GCP/Azure 都有 169.254.169.254 metadata endpoint)
 *
 * 策略:
 * - 禁止 RFC1918 内网段(10.x / 172.16-31.x / 192.168.x)
 * - 禁止 link-local(169.254.x metadata)
 * - 禁止 loopback(127.x)但 NODE_ENV=development 允许 localhost / 127.0.0.1(Ollama 本地接入)
 * - 允许 public DNS / IPv4 public
 *
 * 注:本校验仅拦明显内网,绕过手段(DNS rebinding / CNAME 内网 / IPv6)留 Phase 2 配高级网关
 */

const PRIVATE_IPV4_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16 (link-local + cloud metadata)
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // 100.64.0.0/10 (CGNAT)
  /^198\.(1[8-9])\./, // 198.18.0.0/15 (benchmark)
  /^0\./, // 0.0.0.0/8
  /^224\./, // multicast
];

const LOOPBACK_PATTERNS = [/^127\./, /^::1$/];

const DENY_HOSTNAMES = new Set([
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.aws.amazon.com',
  'instance-data.ec2.internal',
]);

/**
 * 校验 apiUrl 是否安全可用(防 SSRF)
 *
 * @param urlStr 待校验 URL
 * @param opts.allowLocalhost dev 模式允许 localhost(默认 NODE_ENV==='development')
 * @returns 错误信息(null = 通过)
 */
export function validateApiUrl(
  urlStr: string,
  opts: { allowLocalhost?: boolean } = {},
): string | null {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return 'URL 格式不对';
  }

  // 仅允许 http(s)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `不支持协议 ${url.protocol}(仅 http/https)`;
  }

  const host = url.hostname.toLowerCase();
  const allowLocal = opts.allowLocalhost ?? process.env.NODE_ENV === 'development';

  // 显式黑名单 hostname
  if (DENY_HOSTNAMES.has(host)) {
    return `禁止访问 metadata / 内网域名:${host}`;
  }

  // loopback
  if (host === 'localhost' || LOOPBACK_PATTERNS.some((re) => re.test(host))) {
    if (!allowLocal) {
      return `生产环境禁止 loopback (${host})`;
    }
    return null; // dev 放行 localhost(Ollama 等)
  }

  // RFC1918 / link-local / multicast / metadata IPv4
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(host)) {
      return `禁止访问内网/保留段 IP:${host}(SSRF 防御)`;
    }
  }

  // IPv6 内网(简化,链路本地 + ULA)
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return `禁止 IPv6 内网/链路本地:${host}`;
  }

  // 短主机名(无 .)可能是 docker 内部服务名 — 仅 dev 允许
  if (!host.includes('.') && !allowLocal) {
    return `生产环境拒绝短主机名(可能为内部服务):${host}`;
  }

  return null;
}
