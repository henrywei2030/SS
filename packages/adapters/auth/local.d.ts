import type { AuthAdapter, LoginCredentials, SessionUser, SignupInput } from './types.js';
export interface LocalAuthConfig {
    jwtSecret: string;
    /** Token 有效期（秒） */
    tokenTtlSec: number;
}
export declare class LocalAuthAdapter implements AuthAdapter {
    private readonly cfg;
    readonly id = "local";
    private readonly secretKey;
    constructor(cfg: LocalAuthConfig);
    login(creds: LoginCredentials): Promise<{
        user: SessionUser;
        token: string;
    }>;
    signup(input: SignupInput): Promise<{
        user: SessionUser;
        token: string;
    }>;
    verifyToken(token: string): Promise<SessionUser>;
    changePassword(userId: string, oldPw: string, newPw: string): Promise<void>;
    logout(_token: string): Promise<void>;
    private signToken;
    private toSession;
}
//# sourceMappingURL=local.d.ts.map