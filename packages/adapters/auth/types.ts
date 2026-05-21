/**
 * AuthAdapter — 认证抽象
 *
 * Phase 1: LocalAuth (email/username + password + JWT)
 * Phase 2: Clerk / WorkOS
 */
export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  locale: string;
}

export interface LoginCredentials {
  identifier: string; // email or username
  password: string;
}

export interface SignupInput {
  email: string;
  username: string;
  displayName: string;
  password: string;
  locale?: string;
}

export interface AuthAdapter {
  readonly id: string;
  login(creds: LoginCredentials): Promise<{ user: SessionUser; token: string }>;
  signup(input: SignupInput): Promise<{ user: SessionUser; token: string }>;
  verifyToken(token: string): Promise<SessionUser>;
  /** 修改密码 */
  changePassword(userId: string, oldPw: string, newPw: string): Promise<void>;
  /** 登出（如有 server-side session 需要清理） */
  logout(token: string): Promise<void>;
}
