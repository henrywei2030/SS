/**
 * LocalAuthAdapter — Phase 1 用本地账号 + JWT
 * 密码: bcrypt
 * Token: jose (JWT HS256)
 */
import { hash, compare } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

import { prisma } from '@ss/db';
import { ForbiddenError, ValidationError } from '@ss/shared';

import type {
  AuthAdapter,
  LoginCredentials,
  SessionUser,
  SignupInput,
} from './types.js';

// #3 perf(2026-06-14):verifyToken 在每个 tRPC 请求(createContext)+ 每次 RSC requireSession 都会
//   prisma.user.findUnique 查一次 user 表。桌面端(内嵌 PG + l1-only 无 Redis)每次导航这 2 次冷查
//   是主要交互延迟来源。加进程内短 TTL 缓存:同一 token 在 TTL 内复用已验 session,跳过 DB 查。
//   代价:封禁/改权限最多延迟 TTL 生效(单机/小团队可接受;需即时则调小 TTL)。token 失效后浏览器
//   不再发送该 cookie,故不构成额外安全面(JWT 本就 stateless 到期前有效)。
const SESSION_CACHE_TTL_MS = 30_000;
const sessionCache = new Map<string, { session: SessionUser; exp: number }>();

export interface LocalAuthConfig {
  jwtSecret: string;
  /** Token 有效期（秒） */
  tokenTtlSec: number;
}

export class LocalAuthAdapter implements AuthAdapter {
  readonly id = 'local';
  private readonly secretKey: Uint8Array;

  constructor(private readonly cfg: LocalAuthConfig) {
    if (cfg.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 chars');
    }
    this.secretKey = new TextEncoder().encode(cfg.jwtSecret);
  }

  async login(creds: LoginCredentials): Promise<{ user: SessionUser; token: string }> {
    // 第 18 轮 audit P0 防御性兜底:即使 router 没 transform 也归一化(adapter 独立可用)
    const identifier = creds.identifier.toLowerCase().trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
        deletedAt: null,
      },
    });
    // 7 轮 audit A3:防时序攻击 — 用户不存在时跑 dummy bcrypt,等时长跟真用户接近
    // 否则 attacker 能通过响应时间枚举 email/username 存在性
    if (!user) {
      // bcrypt cost=10 dummy hash,运行时间跟真 compare 接近(~100ms)
      await compare(creds.password, '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
      throw new ForbiddenError('invalid credentials');
    }
    if (user.status !== 'ACTIVE') throw new ForbiddenError(`account ${user.status.toLowerCase()}`);

    const ok = await compare(creds.password, user.passwordHash);
    if (!ok) throw new ForbiddenError('invalid credentials');

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const session = this.toSession(user);
    const token = await this.signToken(session);
    return { user: session, token };
  }

  async signup(input: SignupInput): Promise<{ user: SessionUser; token: string }> {
    if (input.password.length < 8) {
      throw new ValidationError('password must be at least 8 characters');
    }
    // 第 18 轮 audit P0 防御性兜底:adapter 独立可用,即使 router 没 transform 也归一化
    const email = input.email.toLowerCase().trim();
    const username = input.username.toLowerCase().trim();
    // W1-W7 audit:必须过滤 deletedAt 防软删账号永久占用 email/username
    // 原版漏过滤 → 用户软删后该邮箱永远不能再注册(管理员无法重新建账号)
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
        deletedAt: null,
      },
    });
    if (existing) throw new ValidationError('email or username already in use');

    const passwordHash = await hash(input.password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        username,
        displayName: input.displayName,
        passwordHash,
        locale: input.locale ?? 'zh-CN',
      },
    });
    const session = this.toSession(user);
    const token = await this.signToken(session);
    return { user: session, token };
  }

  async verifyToken(token: string): Promise<SessionUser> {
    const now = Date.now();
    const cached = sessionCache.get(token);
    if (cached && cached.exp > now) return cached.session;
    try {
      const { payload } = await jwtVerify(token, this.secretKey);
      const sub = payload.sub;
      if (!sub) throw new ForbiddenError('invalid token');
      const user = await prisma.user.findUnique({ where: { id: sub } });
      if (!user || user.deletedAt) throw new ForbiddenError('user not found');
      if (user.status !== 'ACTIVE') throw new ForbiddenError(`account ${user.status.toLowerCase()}`);
      const session = this.toSession(user);
      if (sessionCache.size > 500) sessionCache.clear(); // 防多用户场景无界增长
      sessionCache.set(token, { session, exp: now + SESSION_CACHE_TTL_MS });
      return session;
    } catch (e) {
      if (e instanceof ForbiddenError) throw e;
      throw new ForbiddenError('invalid token');
    }
  }

  async changePassword(userId: string, oldPw: string, newPw: string): Promise<void> {
    if (newPw.length < 8) throw new ValidationError('new password must be at least 8 characters');
    // 7 轮 audit A2:必须过滤 deletedAt:null,防软删账号改密复活
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new ForbiddenError('user not found');
    const ok = await compare(oldPw, user.passwordHash);
    if (!ok) throw new ForbiddenError('old password mismatch');
    const passwordHash = await hash(newPw, 10);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async logout(_token: string): Promise<void> {
    // JWT 无 server state；如需 black list 可写入 Redis
  }

  private async signToken(session: SessionUser): Promise<string> {
    return new SignJWT({
      email: session.email,
      username: session.username,
      isAdmin: session.isAdmin,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.id)
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.tokenTtlSec}s`)
      .sign(this.secretKey);
  }

  private toSession(user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    isAdmin: boolean;
    locale: string;
  }): SessionUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      locale: user.locale,
    };
  }
}
