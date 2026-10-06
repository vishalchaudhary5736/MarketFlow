import { User, UserRole } from '../../../../generated/prisma/client';
import type { Request } from 'express';
/** A user row safe to return over HTTP — the password hash is never included. */
export type PublicUser = Omit<User, 'passwordHash'>;

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

/** What the refresh token carries: enough to find and check its session. */
export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  jti: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

export type adminPRequest = Request & { user: JwtPayload };

export type UserTableTypes = User;
