/**
 * AuthAdapter 工厂
 */
export * from './types.js';
export { LocalAuthAdapter } from './local.js';
import { LocalAuthAdapter } from './local.js';
let _instance = null;
export function getAuthAdapter() {
    if (_instance)
        return _instance;
    const driver = (process.env.AUTH_DRIVER ?? 'local').toLowerCase();
    switch (driver) {
        case 'local':
            _instance = new LocalAuthAdapter({
                jwtSecret: required('JWT_SECRET'),
                tokenTtlSec: Number(process.env.AUTH_TOKEN_TTL_SEC ?? '604800'), // 7d
            });
            break;
        case 'clerk':
        case 'workos':
            throw new Error(`${driver} adapter not implemented yet (Phase 2)`);
        default:
            throw new Error(`Unknown AUTH_DRIVER: ${driver}`);
    }
    return _instance;
}
export function resetAuthAdapter() {
    _instance = null;
}
function required(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing required env: ${name}`);
    return v;
}
//# sourceMappingURL=index.js.map