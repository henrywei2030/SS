/**
 * 标准化 storageKey 生成。所有业务代码使用此函数，不要手拼。
 *
 * 形式: {scope}/{projectId|public}/{kind}/{yyyymmdd}/{uuid}.{ext}
 *
 * 示例: project/clx123abc/video/20260521/9f8e7d.mp4
 */
export function buildStorageKey(args) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const id = args.id ?? randomId();
    const owner = args.scope === 'project' && args.projectId ? args.projectId : args.scope;
    const safeExt = args.ext.replace(/^\./, '');
    return `${args.scope}/${owner}/${args.kind}/${today}/${id}.${safeExt}`;
}
function randomId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36).slice(-4);
}
//# sourceMappingURL=types.js.map