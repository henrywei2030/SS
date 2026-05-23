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
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: creds.identifier }, { username: creds.identifier }],
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
    // W1-W7 audit:必须过滤 deletedAt 防软删账号永久占用 email/username
    // 原版漏过滤 → 用户软删后该邮箱永远不能再注册(管理员无法重新建账号)
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: input.email }, { username: input.username }],
        deletedAt: null,
      },
    });
    if (existing) throw new ValidationError('email or username already in use');

    const passwordHash = await hash(input.password, 10);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
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
    try {
      const { payload } = await jwtVerify(token, this.secretKey);
      const sub = payload.sub;
      if (!sub) throw new ForbiddenError('invalid token');
      const user = await prisma.user.findUnique({ where: { id: sub } });
      if (!user || user.deletedAt) throw new ForbiddenError('user not found');
      if (user.status !== 'ACTIVE') throw new ForbiddenError(`account ${user.status.toLowerCase()}`);
      return this.toSession(user);
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
