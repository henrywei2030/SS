/**
 * AuthAdapter 工厂
 */
export * from './types.js';
export { LocalAuthAdapter } from './local.js';
import type { AuthAdapter } from './types.js';
export declare function getAuthAdapter(): AuthAdapter;
export declare function resetAuthAdapter(): void;
//# sourceMappingURL=index.d.ts.map