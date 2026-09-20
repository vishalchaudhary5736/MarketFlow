import { User, UserRole } from '../../../../generated/prisma/client';

/** A user row safe to return over HTTP — the password hash is never included. */
export type PublicUser = Omit<User, 'passwordHash'>;


export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  sessionId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}
