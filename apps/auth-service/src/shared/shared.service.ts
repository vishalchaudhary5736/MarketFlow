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

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_LENGTH = 4;
const BCRYPT_ROUNDS = 12;
const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class SharedService {
  private readonly logger = new Logger(SharedService.name);
  private readonly sessionTTL = 7 * 24 * 60 * 60; // 7 days in seconds

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
    userAgent: string;
    sessionId: string;
    userId: string;
    token: string;
    refreshToken: string;
  }) {
    const session = {
      sessionId: sessionId,
      userId: userId,
      tokenHash: token,
      refreshTokenHash: refreshToken,
      userAgent: userAgent,
      createdAt: new Date().toISOString(),
    };
    await this.cacheService.set(`session:${userId}`, session, this.sessionTTL);
  }

  async getSession(userId: string) {
    return await this.cacheService.get(`session:${userId}`);
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
    await this.cacheService.del(this.otpAttemptsKey(otpType, identifier));
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
    ]);
  }

  // Returns the running total of failed attempts against the current code.
  async recordFailedOtpAttempt(
    otpType: OTP_TYPE,
    identifier: string,
  ): Promise<number> {
    const key = this.otpAttemptsKey(otpType, identifier);
    const attempts = ((await this.cacheService.get<number>(key)) ?? 0) + 1;
    // Expires with the code itself, so the budget cannot outlive it.
    await this.cacheService.set(key, attempts, OTP_TTL_MS);
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
