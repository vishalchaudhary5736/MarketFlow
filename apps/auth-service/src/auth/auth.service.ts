import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  User,
  UserRole,
  UserStatus,
} from '../../../../generated/prisma/client';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { NAVIGATION_SCREENS, OTP_TYPE } from './constants.service';
import { SharedService } from '../shared/shared.service';
import {
  AuthTokens,
  JwtPayload,
  PublicUser,
  RefreshTokenPayload,
  UserTableTypes,
} from '../shared/shared.types';
import { randomBytes } from 'crypto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CheckEmailMobileDto } from './dto/checkEmailMobile.dto';
import type { Response } from 'express';

// Five wrong passwords lock the account for fifteen minutes. The counter and
// the deadline live on the user row (`failedLoginAttempts`, `lockedUntil`) so a
// lockout survives a cache flush or a service restart.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

// The refresh token lives in an httpOnly cookie scoped to /auth, so only the
// refresh (and future logout) calls ever carry it. Setting and clearing must
// use the same options, or the browser keeps the old cookie.
const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // matches the JWT's 7d
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth',
});

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessSecret = process.env.JWT_ACCESS_SECRET;
  private readonly refreshSecret = process.env.JWT_REFRESH_SECRET;
  // Env vars are strings, so only the literal "true" enables the bypass;
  // unset keeps the previous default (on).
  private readonly BY_PASS_EMAIL_VERIFICATION =
    (process.env.BY_PASS_EMAIL_VERIFICATION ?? 'true') === 'true';

  constructor(
    private readonly sharedService: SharedService,
    private readonly jwt: JwtService,
  ) {}

  async checkEmailMobile({
    email,
    mobileNumber,
    countryCode,
    role,
  }: CheckEmailMobileDto) {
    // The DTO guarantees email, or countryCode + mobileNumber together; both
    // may be sent, in which case each is checked.
    if (email) {
      const emailTaken = await this.sharedService.prisma.user.findUnique({
        where: { email_role: { email: email.trim().toLowerCase(), role } },
        select: { id: true },
      });
      if (emailTaken) {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'Email already in use. Please enter another email address',
          nextStep: 'RETRY',
          field: 'email',
        });
      }
    }

    if (countryCode && mobileNumber) {
      const mobileTaken = await this.sharedService.prisma.user.findUnique({
        where: {
          countryCode_mobileNumber_role: {
            countryCode: countryCode.trim(),
            mobileNumber: mobileNumber.trim(),
            role,
          },
        },
        select: { id: true },
      });
      if (mobileTaken) {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message:
            'Mobile number already in use. Please enter another mobile number',
          nextStep: 'RETRY',
          field: 'phone',
        });
      }
    }

    const checked =
      email && countryCode && mobileNumber
        ? 'Email and mobile number are'
        : email
          ? 'Email is'
          : 'Mobile number is';

    return { success: true, message: `${checked} available.`, data: null };
  }

  async registerCustomer({
    email,
    password,
    mobileNumber,
    countryCode,
    ...rest
  }: CustomerRegisterDto): Promise<{
    success: boolean;
    message: string;
    data: {
      email: string;
      nextStep: string;
      expiresInSeconds?: number;
      resendAvailableInSeconds?: number;
    };
  }> {
    let user: PublicUser;
    email = email.trim().toLowerCase();
    mobileNumber = mobileNumber.trim();
    countryCode = countryCode.trim();

    try {
      const isExistUser = await this.sharedService.prisma.user.findFirst({
        where: { OR: [{ email }, { countryCode, mobileNumber }] },
        select: {
          email: true,
          mobileNumber: true,
          countryCode: true,
          status: true,
          id: true,
          isEmailVerified: true,
        },
      });

      if (isExistUser) {
        if (!isExistUser.isEmailVerified && this.BY_PASS_EMAIL_VERIFICATION) {
          return {
            success: true,
            message: 'Please verify OTP!',
            data: {
              email,
              nextStep: NAVIGATION_SCREENS.OTP_SCREEN_FOR_VERIFY_EMAIL,
            },
          };
        } else if (
          !isExistUser.isEmailVerified &&
          !this.BY_PASS_EMAIL_VERIFICATION
        ) {
          // first check is previous otp exist and valid.
          const isOtpExist = await this.sharedService.getOtpHash(
            OTP_TYPE.EMAIL_VERIFICATION,
            isExistUser.id,
          );

          // IF PREVIOUS OTP NOT EXIST THEN CREATE NEW ONE
          if (!isOtpExist) {
            const otp = await this.sharedService.generateOtp(
              OTP_TYPE.EMAIL_VERIFICATION,
              isExistUser.id,
            );
            this.logger.debug(`OTP for ${isExistUser.email}: ${otp}`);
          }
          return {
            success: true,
            message:
              'Verification code sent to your email. Please verify your email address.',
            data: {
              email: isExistUser.email,
              nextStep: NAVIGATION_SCREENS.OTP_SCREEN_FOR_VERIFY_EMAIL,
              expiresInSeconds: 300,
              resendAvailableInSeconds: 60,
            },
          };
        }

        this.rejectExistingAccount(
          isExistUser,
          email,
          mobileNumber,
          countryCode,
        );
      }

      const passwordHash = await this.sharedService.hashPassword(password);

      user = await this.sharedService.prisma.user.create({
        data: {
          ...rest,
          email,
          mobileNumber,
          countryCode,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
        omit: { passwordHash: true },
      });
    } catch (error) {
      throw this.sharedService.translateKnownErrors(error);
    }

    if (!this.BY_PASS_EMAIL_VERIFICATION) {
      const otp = await this.sharedService.generateOtp(
        OTP_TYPE.EMAIL_VERIFICATION,
        user.id,
      );
      this.logger.debug(`OTP for ${user.email}: ${otp}`);
    }

    return {
      success: true,
      message: this.BY_PASS_EMAIL_VERIFICATION
        ? 'Account created successfully.'
        : 'Account created successfully. Verification code sent to your email.',
      data: {
        email: user.email,
        nextStep: NAVIGATION_SCREENS.OTP_SCREEN_FOR_VERIFY_EMAIL,
        expiresInSeconds: 300,
        resendAvailableInSeconds: 60,
      },
    };
  }

  async resendOtp({ otpType, email }: { otpType: OTP_TYPE; email: string }) {
    try {
      // TO DO (use redis)
      this.logger.log('hit=========>');
      email = email.trim().toLowerCase();

      const isExistUser = await this.sharedService.prisma.user.findFirst({
        where: { email },
        select: {
          email: true,
          id: true,
          mobileNumber: true,
          countryCode: true,
          status: true,
          isEmailVerified: true,
        },
      });

      if (!isExistUser) {
        // 404, not 502: nothing failed upstream, the address is simply
        // not registered — and the client's next step is to sign up.
        throw new NotFoundException({
          code: 'ACCOUNT_NOT_FOUND',
          message: 'No account is registered with this email address.',
          nextStep: 'SIGN_UP',
        });
      } else {
        switch (isExistUser.status) {
          case UserStatus.BLOCKED:
            throw new ForbiddenException({
              code: 'ACCOUNT_SUSPENDED',
              message:
                'This account has been suspended and cannot be used to sign up again. Contact our support team if you believe this is a mistake.',
              nextStep: 'CONTACT_SUPPORT',
            });
          case UserStatus.DELETED:
            throw new GoneException({
              code: 'ACCOUNT_CLOSED',
              message:
                'This account was closed. Reset your password to reopen it, or contact our support team to sign up with these details again.',
              nextStep: 'RESTORE_ACCOUNT',
            });
          case UserStatus.ACTIVE:
            if (
              isExistUser.isEmailVerified &&
              otpType === OTP_TYPE.EMAIL_VERIFICATION
            ) {
              return {
                success: true,
                message:
                  'Your email is already verified. Please login your account',
              };
            }
        }
      }

      if (!this.BY_PASS_EMAIL_VERIFICATION) {
        const otp = await this.sharedService.generateOtp(
          otpType,
          isExistUser.id,
        );
        this.logger.debug(`OTP for ${isExistUser.email}: ${otp}`);
      }

      switch (otpType) {
        case OTP_TYPE.EMAIL_VERIFICATION:
          return {
            success: true,
            message: 'Email verification code sent successfully',
            data: {
              email: email,
              nextStep: NAVIGATION_SCREENS.OTP_SCREEN_FOR_VERIFY_EMAIL,
            },
          };
        case OTP_TYPE.MOBILE_VERIFICATION:
          return {
            success: true,
            message: 'Otp sent successfully',
            data: { email: email, nextStep: 'OTP_SCREEN' },
          };
        case OTP_TYPE.PASSWORD_RESET:
          return {
            success: true,
            message: 'Password reset code sent successfully',
            data: { email: email, nextStep: NAVIGATION_SCREENS.PASSWORD_RESET },
          };
        default:
          throw new BadRequestException({
            code: 'INVALID_OTP_TYPE',
            message: `otpType must be one of: ${Object.values(OTP_TYPE).join(', ')}`,
            nextStep: 'RETRY',
          });
      }
    } catch (error) {
      throw this.sharedService.translateKnownErrors(error);
    }
  }

  async verifyOtp(
    { otpType, email, otp }: VerifyOtpDto,
    userAgent: string | undefined,
    res: Response,
  ) {
    email = email.trim().toLowerCase();
    otp = otp.trim();

    const user = await this.sharedService.prisma.user.findUnique({
      where: { email_role: { email, role: UserRole.CUSTOMER } },
      omit: { passwordHash: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'ACCOUNT_NOT_FOUND',
        message: 'No account is registered with this email address.',
        nextStep: 'SIGN_UP',
      });
    }

    this.sharedService.assertAccountIsUsable(user.status);

    if (this.isAlreadyVerified(otpType, user)) {
      return this.verificationSucceeded(otpType, user, true);
    }

    if (!this.BY_PASS_EMAIL_VERIFICATION) {
      await this.sharedService.assertOtpIsValid(otpType, user.id, otp);
    }

    const applied = await this.markVerified(otpType, user.email);

    if (!applied) {
      return this.verificationSucceeded(otpType, user, true);
    }

    await this.sharedService.deleteOtp(otpType, user.id);

    this.logger.log(`Verified ${otpType} for ${user.email}`);

    const { accessToken, refreshToken } = await this.startSession(
      user,
      userAgent,
    );

    this.setRefreshCookie(res, refreshToken);

    return this.verificationSucceeded(
      otpType,
      user,
      false,
      accessToken,
      refreshToken,
    );
  }

  /**
   * Step 1 of the reset: issues a code to the address on the account.
   *
   * No mailer is wired up yet, so the code goes to the debug log instead of an
   * inbox. Everything around it is real — the code is hashed, expires, and is
   * rate limited — so swapping the log line for a send is the only step left.
   */
  async forgotPassword({ email }: ForgotPasswordDto) {
    const account = await this.findCustomerForPasswordReset(email);
    const cooldown = await this.sharedService.otpResendCooldownRemaining(
      OTP_TYPE.PASSWORD_RESET,
      account.id,
    );

    if (cooldown > 0) {
      throw new HttpException(
        {
          code: 'OTP_RESEND_COOLDOWN',
          message: `A code was already sent. Request another in ${cooldown} second(s).`,
          nextStep: NAVIGATION_SCREENS.PASSWORD_RESET,
          expiresInSeconds: 300,
          retryAfterSeconds: 60,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = await this.sharedService.generateOtp(
      OTP_TYPE.PASSWORD_RESET,
      account.id,
    );

    // TO DO: send this to the address instead of logging it.
    this.logger.debug(
      `Password reset OTP for ${account.firstName} <${account.email}>: ${otp}`,
    );

    return {
      success: true,
      message: 'Password reset code sent to your email.',
      data: {
        email: account.email,
        nextStep: NAVIGATION_SCREENS.PASSWORD_RESET,
        expiresInSeconds: 300,
        resendAvailableInSeconds: 60,
      },
    };
  }

  /**
   * Step 2, optional: checks the code without spending it.
   *
   * The code is deliberately not deleted here — /auth/reset-password asks for
   * it again and is the only place that consumes it. So a client that skips
   * this call still works, and one that makes it is not left holding a code
   * the server already threw away.
   */
  async verifyPasswordResetOtp({ email, otp }: VerifyResetOtpDto) {
    const account = await this.findCustomerForPasswordReset(email);

    if (!this.BY_PASS_EMAIL_VERIFICATION) {
      await this.sharedService.assertOtpIsValid(
        OTP_TYPE.PASSWORD_RESET,
        account.id,
        otp.trim(),
      );
    }

    return {
      success: true,
      message: 'Code verified. Choose a new password.',
      data: { email: account.email, nextStep: 'RESET_PASSWORD' },
    };
  }

  /** Step 3: sets the new password and signs every device out. */
  async resetPassword({ email, otp, newPassword }: ResetPasswordDto) {
    const account = await this.findCustomerForPasswordReset(email);

    const otpWasChecked = !this.BY_PASS_EMAIL_VERIFICATION;
    if (otpWasChecked) {
      await this.sharedService.assertOtpIsValid(
        OTP_TYPE.PASSWORD_RESET,
        account.id,
        otp.trim(),
      );
    }

    const reusesCurrentPassword = await this.sharedService.comparePassword(
      newPassword,
      account.passwordHash,
    );

    if (reusesCurrentPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_REUSED',
        message: 'Your new password must be different from the current one.',
        nextStep: 'RETRY',
      });
    }

    const passwordHash = await this.sharedService.hashPassword(newPassword);

    await this.sharedService.prisma.user.update({
      where: { id: account.id },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(otpWasChecked && !account.isEmailVerified
          ? { isEmailVerified: true, emailVerifiedAt: new Date() }
          : {}),
      },
    });

    await Promise.all([
      this.sharedService.deleteOtp(OTP_TYPE.PASSWORD_RESET, account.id),
      this.sharedService.deleteAllUserSessions(account.id),
    ]);

    this.logger.log(`Password reset for ${account.email}`);

    return {
      success: true,
      message: 'Password updated successfully. Sign in with your new password.',
      data: { nextStep: NAVIGATION_SCREENS.LOGIN_SCREEN },
    };
  }

  private async findCustomerForPasswordReset(email: string): Promise<User> {
    const account = await this.sharedService.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), role: UserRole.CUSTOMER },
    });

    if (!account) {
      throw new BadRequestException({
        code: 'ACCOUNT_NOT_EXISTS',
        message: `Account is not configured with this email.`,
        nextStep: 'FORGOT_PASSWORD',
      });
    }

    this.sharedService.assertAccountIsUsable(account.status);

    return account;
  }

  async login(
    { email, countryCode, mobileNumber, password }: LoginDto,
    userAgent: string | undefined,
    res: Response,
  ) {
    // The DTO guarantees email, or countryCode + mobileNumber together.
    const byEmail = !!email;
    const user = email
      ? await this.sharedService.prisma.user.findUnique({
          where: {
            email_role: {
              email: email.trim().toLowerCase(),
              role: UserRole.CUSTOMER,
            },
          },
        })
      : countryCode && mobileNumber
        ? await this.sharedService.prisma.user.findUnique({
            where: {
              countryCode_mobileNumber_role: {
                countryCode: countryCode.trim(),
                mobileNumber: mobileNumber.trim(),
                role: UserRole.CUSTOMER,
              },
            },
          })
        : null;

    if (!user) {
      throw this.invalidCredentials(byEmail);
    }

    this.sharedService.assertAccountIsUsable(user.status);
    this.assertNotLockedOut(user.lockedUntil);

    const passwordMatches = await this.sharedService.comparePassword(
      password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      const lockedUntil = await this.recordFailedLogin(
        user.id,
        user.failedLoginAttempts,
      );

      // A wrong password that tripped the limit answers 423, not 401: the next
      // attempt would be refused anyway, and the client needs to say so.
      this.assertNotLockedOut(lockedUntil);

      throw this.invalidCredentials(byEmail);
    }

    console.log('user=>', user);
    if (!this.BY_PASS_EMAIL_VERIFICATION && !user.isEmailVerified) {
      await this.sendEmailVerificationOtp(user.id, user.email);
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message:
          'Verify your email address to continue. We have sent a verification code to it.',
        nextStep: NAVIGATION_SCREENS.OTP_SCREEN_FOR_VERIFY_EMAIL,
        email: user.email,
        expiresInSeconds: 300,
        resendAvailableInSeconds: 60,
      });
    }

    if (this.BY_PASS_EMAIL_VERIFICATION && !user.isEmailVerified) {
      console.log('user=>');
      await this.sendEmailVerificationOtp(user.id, user.email);
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message:
          'Verify your email address to continue. We have sent a verification code to it.',
        nextStep: NAVIGATION_SCREENS.OTP_SCREEN_FOR_VERIFY_EMAIL,
        email: user.email,
        expiresInSeconds: 300,
        resendAvailableInSeconds: 60,
      });
    }

    const [tokens, publicUser] = await Promise.all([
      this.startSession(user, userAgent),
      this.sharedService.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
        },
        omit: {
          passwordHash: true,
          failedLoginAttempts: true,
          lockedUntil: true,
          deletedAt: true,
        },
      }),
    ]);

    this.logger.log(`Signed in ${user.email}`);

    this.setRefreshCookie(res, tokens.refreshToken);

    return {
      success: true,
      data: {
        message: 'Signed in successfully.',
        userDetail: publicUser,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        nextStep: 'Home',
      },
    };
  }

  /** Re-issues a verification code, unless one went out inside the cooldown. */
  private async sendEmailVerificationOtp(userId: string, email: string) {
    const cooldown = await this.sharedService.otpResendCooldownRemaining(
      OTP_TYPE.EMAIL_VERIFICATION,
      userId,
    );

    if (cooldown > 0) {
      return;
    }

    const otp = await this.sharedService.generateOtp(
      OTP_TYPE.EMAIL_VERIFICATION,
      userId,
    );
    console.log('OTP============================>', otp);
  }

  /** 401 for both a missing account and a wrong password — deliberately identical. */
  private invalidCredentials(byEmail = true): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: byEmail
        ? 'That email address and password do not match.'
        : 'That phone number and password do not match.',
      nextStep: 'RETRY',
    });
  }

  private assertNotLockedOut(lockedUntil: Date | null): void {
    if (!lockedUntil || lockedUntil.getTime() <= Date.now()) {
      return;
    }

    const retryAfterSeconds = Math.ceil(
      (lockedUntil.getTime() - Date.now()) / 1000,
    );

    // 423 Locked: the credentials are not being judged at all, the account is
    // temporarily closed to sign-in attempts.
    throw new HttpException(
      {
        code: 'ACCOUNT_LOCKED',
        message: `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        nextStep: 'RETRY_LATER',
        retryAfterSeconds,
      },
      HttpStatus.LOCKED,
    );
  }

  /** Returns the new lock deadline when this attempt tripped the limit. */
  private async recordFailedLogin(
    userId: string,
    failedLoginAttempts: number,
  ): Promise<Date | null> {
    const attempts = failedLoginAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + LOGIN_LOCK_DURATION_MS)
      : null;

    await this.sharedService.prisma.user.update({
      where: { id: userId },
      data: {
        // Zeroed on lock so the wait buys a fresh budget rather than one
        // attempt that re-locks immediately.
        failedLoginAttempts: shouldLock ? 0 : attempts,
        ...(shouldLock ? { lockedUntil } : {}),
      },
    });

    return lockedUntil;
  }

  /**
   * Mints a session id, signs the token pair against it, and caches the
   * session. Every entry point that hands out tokens goes through here, so a
   * session always exists for a token that was issued.
   */
  /**
   * Swaps the refresh-token cookie for a new access token.
   *
   * The refresh token is rotated on every call: the session keeps only the
   * hash of the newest one. An older token that still verifies means it was
   * copied and used after the owner refreshed, so the whole session is
   * revoked. Every failure also clears the cookie, so the client can go
   * straight to sign-in.
   */
  async refresh(
    refreshToken: string | undefined,
    userAgent: string | undefined,
    res: Response,
  ) {
    try {
      if (!refreshToken) {
        throw this.refreshRejected(
          'REFRESH_TOKEN_MISSING',
          'You are not signed in. Please sign in to continue.',
        );
      }

      let payload: RefreshTokenPayload;
      try {
        payload = await this.jwt.verifyAsync<RefreshTokenPayload>(
          refreshToken,
          { secret: this.refreshSecret },
        );
      } catch {
        throw this.refreshRejected(
          'REFRESH_TOKEN_INVALID',
          'Your session has expired. Please sign in again.',
        );
      }

      // Tokens issued before sessionId was added to the payload cannot be
      // matched to a session.
      if (!payload.sessionId) {
        throw this.refreshRejected(
          'REFRESH_TOKEN_INVALID',
          'Your session has expired. Please sign in again.',
        );
      }

      const session = await this.sharedService.getSession(payload.sessionId);

      if (!session || session.userId !== payload.sub) {
        throw this.refreshRejected(
          'SESSION_EXPIRED',
          'Your session has ended. Please sign in again.',
        );
      }

      if (!this.sharedService.refreshTokenMatches(session, refreshToken)) {
        await this.sharedService.deleteSession(
          session.sessionId,
          session.userId,
        );
        this.logger.warn(
          `Refresh token reuse on session ${session.sessionId}; session revoked`,
        );
        throw this.refreshRejected(
          'REFRESH_TOKEN_REUSED',
          'For your security this session was ended. Please sign in again.',
        );
      }

      const user = await this.sharedService.prisma.user.findUnique({
        where: { id: payload.sub },
        omit: { passwordHash: false },
      });

      if (!user) {
        await this.sharedService.deleteSession(
          session.sessionId,
          session.userId,
        );
        throw this.refreshRejected(
          'SESSION_EXPIRED',
          'Your session has ended. Please sign in again.',
        );
      }

      this.sharedService.assertAccountIsUsable(user.status);

      // Same session, new pair: overwriting the session stores the new
      // refresh-token hash, which is what retires the old token.
      const tokens = await this.issueTokens(user, session.sessionId);
      await this.sharedService.cacheSession({
        sessionId: session.sessionId,
        userId: user.id,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userAgent: userAgent ?? session.userAgent,
      });

      this.setRefreshCookie(res, tokens.refreshToken);

      return {
        success: true,
        message: 'Session refreshed.',
        data: { accessToken: tokens.accessToken },
      };
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw error;
    }
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...refreshCookieOptions(),
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private refreshRejected(code: string, message: string) {
    return new UnauthorizedException({ code, message, nextStep: 'SIGN_IN' });
  }

  private async startSession(
    user: { id: string; email: string; role: UserRole },
    userAgent: string | undefined,
  ): Promise<AuthTokens> {
    const sessionId = randomBytes(16).toString('base64url');

    const tokens = await this.issueTokens(user, sessionId);

    await this.sharedService.cacheSession({
      sessionId,
      userId: user.id,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userAgent: userAgent ?? null,
    });

    return tokens;
  }

  private isAlreadyVerified(
    otpType: OTP_TYPE,
    user: Pick<User, 'isEmailVerified' | 'phoneVerifiedAt'>,
  ): boolean {
    return otpType === OTP_TYPE.EMAIL_VERIFICATION
      ? user.isEmailVerified
      : user.phoneVerifiedAt !== null;
  }

  private async markVerified(
    otpType: OTP_TYPE,
    email: string,
  ): Promise<boolean> {
    const { count } =
      otpType === OTP_TYPE.EMAIL_VERIFICATION
        ? await this.sharedService.prisma.user.updateMany({
            where: { email, isEmailVerified: false },
            data: { isEmailVerified: true, emailVerifiedAt: new Date() },
          })
        : await this.sharedService.prisma.user.updateMany({
            where: { email, phoneVerifiedAt: null },
            data: { phoneVerifiedAt: new Date() },
          });

    return count > 0;
  }

  private verificationSucceeded(
    otpType: OTP_TYPE,
    user: PublicUser,
    alreadyDone: boolean,
    accessToken?: string,
    refreshToken?: string,
  ) {
    const subject =
      otpType === OTP_TYPE.EMAIL_VERIFICATION
        ? 'Email address'
        : 'Phone number';

    return {
      success: true,
      message: alreadyDone
        ? `${subject} is already verified. You can sign in.`
        : `${subject} verified successfully.`,
      data: alreadyDone
        ? { nextStep: 'Login' }
        : {
            userDetail: user,
            accessToken,
            refreshToken,
            nextStep: 'Dashboard',
          },
    };
  }

  private rejectExistingAccount(
    existing: Pick<User, 'email' | 'countryCode' | 'mobileNumber' | 'status'>,
    email: string,
    mobileNumber: string,
    countryCode: string,
  ): never {
    // Suspended and closed accounts answer the same way everywhere, so that
    // wording lives in SharedService. Both of those throw.
    this.sharedService.assertAccountIsUsable(existing.status);

    // Name the field that collided so the client can highlight that input
    // instead of marking the whole form as wrong.
    const emailTaken = existing.email === email;
    const phoneTaken = existing.mobileNumber === mobileNumber;
    const countryCodeTaken = existing.countryCode === countryCode;
    const field =
      emailTaken && phoneTaken && countryCodeTaken
        ? 'both'
        : phoneTaken && countryCodeTaken
          ? 'phone'
          : 'email';
    const label =
      field === 'both'
        ? 'email address and phone number'
        : field === 'email'
          ? 'email address'
          : 'phone number';

    throw new ConflictException({
      code: 'ACCOUNT_ALREADY_EXISTS',
      message: `An account with this ${label} already exists. Sign in instead, or reset your password if you have forgotten it.`,
      nextStep: 'SIGN_IN',
      field,
    });
  }

  private async issueTokens(
    user: { email: string; id: string; role: UserRole },
    sessionId: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.accessSecret,
        expiresIn: '15m',
      }),
      this.jwt.signAsync(
        {
          sub: user.id,
          sessionId,
          jti: randomBytes(16).toString('base64url'),
        } satisfies RefreshTokenPayload,
        {
          secret: this.refreshSecret,
          expiresIn: '7d',
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }
}
