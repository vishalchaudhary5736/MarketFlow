import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { Prisma, UserStatus } from '../../../../generated/prisma/client';
import { OTP_TYPE } from '../auth/constants.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CachedSession {
  sessionId: string;
  userId: string;
  tokenHash: string;
  refreshTokenHash: string;
  userAgent: string | null;
  createdAt: string;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_LENGTH = 4;
const BCRYPT_ROUNDS = 12;
const MAX_OTP_ATTEMPTS = 5;
const OTP_ATTEMPTS_TTL_MS = 15 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 5*60 * 1000;

@Injectable()
export class SharedService {
  private readonly logger = new Logger(SharedService.name);
  private readonly sessionTTL = 7 * 24 * 60 * 60 * 1000;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheService: Cache,
    public readonly prisma: PrismaService,
  ) {}

  async cacheSession({
    sessionId,
    userId,
    token,
    refreshToken,
    userAgent,
  }: {
    userAgent?: string | null;
    sessionId: string;
    userId: string;
    token: string;
    refreshToken: string;
  }) {
    const session: CachedSession = {
      sessionId,
      userId,
      tokenHash: token,
      refreshTokenHash: refreshToken,
      userAgent: userAgent ?? null,
      createdAt: new Date().toISOString(),
    };

    await this.cacheService.set(
      this.sessionKey(sessionId),
      session,
      this.sessionTTL,
    );

    const sessionIds = await this.getUserSessionIds(userId);

    if (!sessionIds.includes(sessionId)) {
      await this.cacheService.set(
        this.userSessionsKey(userId),
        [...sessionIds, sessionId],
        this.sessionTTL,
      );
    }
  }

  async getSession(sessionId: string): Promise<CachedSession | null> {
    return (
      (await this.cacheService.get<CachedSession>(
        this.sessionKey(sessionId),
      )) ?? null
    );
  }

  async getUserSessionIds(userId: string): Promise<string[]> {
    return (
      (await this.cacheService.get<string[]>(this.userSessionsKey(userId))) ??
      []
    );
  }

  /** Ends one session — a single sign-out, or one device revoked. */
  async deleteSession(sessionId: string, userId: string) {
    await this.cacheService.del(this.sessionKey(sessionId));

    const remaining = (await this.getUserSessionIds(userId)).filter(
      (id) => id !== sessionId,
    );

    await this.cacheService.set(
      this.userSessionsKey(userId),
      remaining,
      this.sessionTTL,
    );
  }

  /** Ends every session for a user — password change, "sign out everywhere". */
  async deleteAllUserSessions(userId: string) {
    const sessionIds = await this.getUserSessionIds(userId);

    await Promise.all(
      sessionIds.map((id) => this.cacheService.del(this.sessionKey(id))),
    );

    await this.cacheService.del(this.userSessionsKey(userId));
  }

  private sessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private userSessionsKey(userId: string): string {
    return `user-sessions:${userId}`;
  }

  async generateOtp(otpType: OTP_TYPE, identifier: string): Promise<string> {
    const max = 10 ** OTP_LENGTH;
    const otp = String(randomInt(0, max)).padStart(OTP_LENGTH, '0');
    await this.storeOtpHash(otpType, identifier, this.hashOtp(otp));
    return otp;
  }

  hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  async storeOtpHash(otpType: OTP_TYPE, identifier: string, otpHash: string) {
    await this.cacheService.set(
      this.otpKey(otpType, identifier),
      otpHash,
      OTP_TTL_MS,
    );
    await this.cacheService.set(
      this.otpResendCooldownKey(otpType, identifier),
      Date.now() + OTP_RESEND_COOLDOWN_MS,
      OTP_RESEND_COOLDOWN_MS,
    );
  }

 
  async otpResendCooldownRemaining(
    otpType: OTP_TYPE,
    identifier: string,
  ): Promise<number> {
    const readyAt = await this.cacheService.get<number>(
      this.otpResendCooldownKey(otpType, identifier),
    );

    if (!readyAt) {
      return 0;
    }

    return Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
  }

  async getOtpHash(
    otpType: OTP_TYPE,
    identifier: string,
  ): Promise<string | undefined> {
    return (
      (await this.cacheService.get<string>(this.otpKey(otpType, identifier))) ??
      undefined
    );
  }

  async deleteOtp(otpType: OTP_TYPE, identifier: string) {
    await Promise.all([
      this.cacheService.del(this.otpKey(otpType, identifier)),
      this.cacheService.del(this.otpAttemptsKey(otpType, identifier)),
      this.cacheService.del(this.otpResendCooldownKey(otpType, identifier)),
    ]);
  }

  // Returns the running total of failed attempts against the current code.
  async recordFailedOtpAttempt(
    otpType: OTP_TYPE,
    identifier: string,
  ): Promise<number> {
    const key = this.otpAttemptsKey(otpType, identifier);
    const attempts = ((await this.cacheService.get<number>(key)) ?? 0) + 1;
    // Outlives the code on purpose: a budget that died with each code would
    // reset every time a new one was requested.
    await this.cacheService.set(key, attempts, OTP_ATTEMPTS_TTL_MS);
    return attempts;
  }

  // OTP_TYPE members are strings, so interpolating the value directly already
  // gives a readable key: `otp:EMAIL_VERIFICATION:<email>`.
  private otpKey(otpType: OTP_TYPE, identifier: string): string {
    return `otp:${otpType}:${identifier}`;
  }

  private otpAttemptsKey(otpType: OTP_TYPE, identifier: string): string {
    return `otp-attempts:${otpType}:${identifier}`;
  }

  private otpResendCooldownKey(otpType: OTP_TYPE, identifier: string): string {
    return `otp-cooldown:${otpType}:${identifier}`;
  }

  // ---- Passwords ----------------------------------------------------------

  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  // ---- Account state ------------------------------------------------------

  /**
   * Refuses accounts that exist but must not be used. Shared because every
   * entry point — register, login, resend, verify, password reset — owes the
   * caller the same answer for a suspended or closed account.
   */
  assertAccountIsUsable(status: UserStatus): void {
    if (status === UserStatus.BLOCKED) {
      // 403 rather than 409: the details are not the problem, the account is.
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message:
          'This account has been suspended. Contact our support team if you believe this is a mistake.',
        action: 'CONTACT_SUPPORT',
      });
    }

    if (status === UserStatus.DELETED) {
      // 410 Gone: the account existed and was intentionally retired.
      throw new GoneException({
        code: 'ACCOUNT_CLOSED',
        message:
          'This account was closed. Reset your password to reopen it, or contact our support team.',
        action: 'RESTORE_ACCOUNT',
      });
    }
  }

  // ---- OTP verification ---------------------------------------------------

  /**
   * Throws unless `otp` matches the stored code. Lives here with the storage
   * it reads, so the attempt budget cannot be enforced in one caller and
   * forgotten in another.
   */
  async assertOtpIsValid(
    otpType: OTP_TYPE,
    identifier: string,
    otp: string,
  ): Promise<void> {
    const storedHash = await this.getOtpHash(otpType, identifier);

    // Absent means expired or never issued. Both are 410: the thing the client
    // is referring to is gone, and the fix is to ask for a new one.
    if (!storedHash) {
      throw new GoneException({
        code: 'OTP_EXPIRED',
        message: 'This code has expired. Request a new one to continue.',
        action: 'RESEND_OTP',
      });
    }

    if (this.otpMatches(otp, storedHash)) {
      return;
    }

    const attempts = await this.recordFailedOtpAttempt(otpType, identifier);
    const attemptsRemaining = MAX_OTP_ATTEMPTS - attempts;

    if (attemptsRemaining <= 0) {
      await this.deleteOtp(otpType, identifier);
      this.logger.warn(`OTP attempt limit reached for ${identifier}`);

      throw new HttpException(
        {
          code: 'OTP_ATTEMPTS_EXCEEDED',
          message:
            'Too many incorrect attempts. This code has been cancelled — request a new one.',
          action: 'RESEND_OTP',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw new UnauthorizedException({
      code: 'OTP_INVALID',
      message: 'That code is not correct. Check it and try again.',
      action: 'RETRY',
      attemptsRemaining,
    });
  }

  private otpMatches(otp: string, storedHash: string): boolean {
    const candidate = Buffer.from(this.hashOtp(otp), 'hex');
    const expected = Buffer.from(storedHash, 'hex');

    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  }

  // ---- Database errors ----------------------------------------------------

  /**
   * Turns a unique-constraint violation into a 409 the client can act on.
   * Shared so a duplicate email reads the same whether it came from
   * registration or from an admin creating a user.
   */
  translateKnownErrors(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const columns = (error.meta?.target as string[] | undefined) ?? [];
      const field = columns.includes('phone') ? 'phone' : 'email';
      const label = field === 'phone' ? 'phone number' : 'email address';

      return new ConflictException({
        code: 'ACCOUNT_ALREADY_EXISTS',
        message: `An account with this ${label} already exists. Sign in instead, or reset your password if you have forgotten it.`,
        action: 'SIGN_IN',
        field,
      });
    }

    this.logger.error(error instanceof Error ? error.stack : String(error));
    return error;
  }
}
