/**
 * Type guard utilities — 替代 `as Record<string, unknown>` 后裸 access 的不安全模式。
 *
 * 二十九收工 S8:之前散在 breakdown.ts / seedance.ts / parseQueryResponse 等处的
 * `(value as Record<string, unknown>).foo` 改用 asRecord(value)?.foo,
 * 运行时 guard + 编译时 narrow 一气搞定。
 */

/**
 * 把 unknown 安全转成 `Record<string, unknown> | null`。
 *
 * @example
 *   const root = asRecord(json);
 *   if (!root) return null;
 *   const data = asRecord(root.data);
 *   const content = data?.content;  // 类型: unknown
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * 把 unknown 安全转成 `string | null`(typeof guard)。
 */
export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * 把 unknown 安全转成 `number | null`(typeof + 有限性 guard)。
 */
export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
