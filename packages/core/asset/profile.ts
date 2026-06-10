/**
 * Asset.profileJson(半结构化档案)server 侧安全提取。
 * web 端另有 components/asset-profile-fields.tsx 的 parseProfileJson(读-改-写全量用);
 * 这里只做生成链路需要的只读字段提取,容忍脏数据(Json 列可能被旧版本写入任意形状)。
 */

/** 声音设定描述(profileJson.voiceLabel,如「低沉沙哑的中年男声」);无/脏返回 null */
export function extractVoiceLabel(profileJson: unknown): string | null {
  if (!profileJson || typeof profileJson !== 'object' || Array.isArray(profileJson)) {
    return null;
  }
  const v = (profileJson as Record<string, unknown>).voiceLabel;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 100) : null;
}
