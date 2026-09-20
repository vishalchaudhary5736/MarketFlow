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
import { OTP_TYPE } from './constants.service';
import { SharedService } from '../shared/shared.service';
import {
  AuthTokens,
  JwtPayload,
  PublicUser,
  UserTableTypes,
} from '../shared/shared.types';
import { randomBytes } from 'crypto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { isEmailIdentifier, phoneVariants } from './dto/identifier';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// Five wrong passwords lock the account for fifteen minutes. The counter and
// the deadline live on the user row (`failedLoginAttempts`, `lockedUntil`) so a
// lockout survives a cache flush or a service restart.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessSecret = process.env.JWT_ACCESS_SECRET;
  private readonly refreshSecret = process.env.JWT_REFRESH_SECRET;
  private readonly BY_PASS_EMAIL_VERIFICATION =
    process.env.BY_PASS_EMAIL_VERIFICATION;

  constructor(
    private readonly sharedService: SharedService,
    private readonly jwt: JwtService,
  ) {}

  async registerCustomer({
    email,
    password,
    phone,
    ...rest
  }: CustomerRegisterDto): Promise<{
    success: boolean;
    message: string;
    data: { email: string; nextStep: string };
  }> {
    let user: PublicUser;
    email = email.trim().toLowerCase();
    phone = phone.trim();

    try {
      // Both columns are unique across every role, so the lookup is not scoped
      // to CUSTOMER: an address already taken by a seller still collides.
      const isExistUser = await this.sharedService.prisma.user.findFirst({
        where: { OR: [{ email }, { phone }] },
        select: {
          email: true,
          phone: true,
          status: true,
          id: true,
          isEmailVerified: true,
        },
      });

      if (isExistUser) {
        // TO DO: Send verification email with a link to the frontend that includes a
        if (
          this.BY_PASS_EMAIL_VERIFICATION !== 'true' &&
          isExistUser.status === UserStatus.ACTIVE &&
          !isExistUser.isEmailVerified
        ) {
          const isOtpExist = await this.sharedService.getOtpHash(
            OTP_TYPE.EMAIL_VERIFICATION,
            isExistUser.id,
          );
          if (!isOtpExist) {
            const otp = await this.sharedService.generateOtp(
              OTP_TYPE.EMAIL_VERIFICATION,
              isExistUser.id,
            );
            this.logger.debug(`OTP for ${isExistUser.email}: ${otp}`);
          }
          return {
            success: true,
            message: 'Verification code sent to your email.',
            data: { email: isExistUser.email, nextStep: 'VERIFY_EMAIL' },
          };
        }

        if (
          this.BY_PASS_EMAIL_VERIFICATION === 'true' &&
          isExistUser.status === UserStatus.ACTIVE &&
          !isExistUser.isEmailVerified
        ) {
          return {
            success: true,
            message: 'Please verify OTP!',
            data: { email, nextStep: 'VERIFY_EMAIL' },
          };
        }

        this.rejectExistingAccount(isExistUser, email, phone);
      }

      const passwordHash = await this.sharedService.hashPassword(password);

      user = await this.sharedService.prisma.user.create({
        data: {
          ...rest,
          email,
          phone,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
        omit: { passwordHash: true },
      });
    } catch (error) {
      throw this.sharedService.translateKnownErrors(error);
    }

    if (this.BY_PASS_EMAIL_VERIFICATION !== 'true') {
      const otp = await this.sharedService.generateOtp(
        OTP_TYPE.EMAIL_VERIFICATION,
        user.id,
      );
      this.logger.debug(`OTP for ${user.email}: ${otp}`);
    }

    return {
      success: true,
      message:
        this.BY_PASS_EMAIL_VERIFICATION === 'true'
          ? 'Account created successfully.'
          : 'Account created successfully. Verification code sent to your email.',
      data: { email: user.email, nextStep: 'VERIFY_EMAIL' },
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
          phone: true,
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
          action: 'SIGN_UP',
        });
      } else {
        switch (isExistUser.status) {
          case UserStatus.BLOCKED:
            throw new ForbiddenException({
              code: 'ACCOUNT_SUSPENDED',
              message:
                'This account has been suspended and cannot be used to sign up again. Contact our support team if you believe this is a mistake.',
              action: 'CONTACT_SUPPORT',
            });
          case UserStatus.DELETED:
            throw new GoneException({
              code: 'ACCOUNT_CLOSED',
              message:
                'This account was closed. Reset your password to reopen it, or contact our support team to sign up with these details again.',
              action: 'RESTORE_ACCOUNT',
            });
          case UserStatus.ACTIVE:
            if (isExistUser.isEmailVerified) {
              return {
                success: true,
                message:
                  'Your email is already verified. Please login your account',
              };
            }
        }
      }

      // TO - DO
      if (this.BY_PASS_EMAIL_VERIFICATION === 'false') {
        const otp = await this.sharedService.generateOtp(
          OTP_TYPE.EMAIL_VERIFICATION,
          isExistUser.id,
        );
        this.logger.debug(`OTP for ${isExistUser.email}: ${otp}`);
      }

      switch (otpType) {
        case OTP_TYPE.EMAIL_VERIFICATION:
          return {
            success: true,
            message: 'Otp sent successfully',
            data: { email: email, nextStep: 'VERIFY_EMAIL' },
          };
        case OTP_TYPE.MOBILE_VERIFICATION:
          return {
            success: true,
            message: 'Otp sent successfully',
            data: { email: email, nextStep: 'VERIFY_EMAIL' },
          };
        default:
          throw new BadRequestException({
            code: 'INVALID_OTP_TYPE',
            message: `otpType must be one of: ${Object.values(OTP_TYPE).join(', ')}`,
            action: 'RETRY',
          });
      }
    } catch (error) {
      throw this.sharedService.translateKnownErrors(error);
    }
  }

  async verifyOtp(
    { otpType, email, otp }: VerifyOtpDto,
    userAgent: string | undefined,
  ) {
    email = email.trim().toLowerCase();
    otp = otp.trim();

    const user = await this.sharedService.prisma.user.findUnique({
      where: { email },
      omit: { passwordHash: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'ACCOUNT_NOT_FOUND',
        message: 'No account is registered with this email address.',
        action: 'SIGN_UP',
      });
    }

    this.sharedService.assertAccountIsUsable(user.status);

    if (this.isAlreadyVerified(otpType, user)) {
      return this.verificationSucceeded(otpType, user, true);
    }

    if (this.BY_PASS_EMAIL_VERIFICATION !== 'true') {
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
          action: 'RETRY_LATER',
          retryAfterSeconds: cooldown,
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
      data: { email: account.email, nextStep: 'VERIFY_RESET_OTP' },
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

    if (this.BY_PASS_EMAIL_VERIFICATION !== 'true') {
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

    const otpWasChecked = this.BY_PASS_EMAIL_VERIFICATION !== 'true';
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
        action: 'RETRY',
      });
    }

    const passwordHash = await this.sharedService.hashPassword(newPassword);

    await this.sharedService.prisma.user.update({
      where: { id: account.id },
      data: {
        passwordHash,
        // A reset is also the way out of a lockout: the account was locked to
        // stop password guessing, and the password just changed.
        failedLoginAttempts: 0,
        lockedUntil: null,
        // Reading a code sent to the address proves the address — but only
        // when the code was actually checked.
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
      data: { email: account.email, nextStep: 'Login' },
    };
  }

  /**
   * The account lookup all three reset steps start from. Scoped to CUSTOMER,
   * matching the rest of this flow — staff and seller passwords are not reset
   * through the storefront endpoints.
   */
  private async findCustomerForPasswordReset(email: string): Promise<User> {

    const account = await this.sharedService.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), role: UserRole.CUSTOMER },
    });

    if (!account) {
      throw new BadRequestException({
        code: 'ACCOUNT_NOT_EXISTS',
        message: `Account is not configured with this email.`,
        action: 'FORGOT_PASSWORD',
      });
    }

    this.sharedService.assertAccountIsUsable(account.status);

    return account;
  }

  async login(
    { identifier, password }: LoginDto,
    userAgent: string | undefined,
  ) {
    identifier = identifier.trim();

    const byEmail = isEmailIdentifier(identifier);
    const user = byEmail
      ? await this.sharedService.prisma.user.findUnique({
          where: { email: identifier.toLowerCase() },
        })
      : await this.sharedService.prisma.user.findFirst({
          where: { phone: { in: phoneVariants(identifier) } },
        });

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

    if (this.BY_PASS_EMAIL_VERIFICATION !== 'true' && !user.isEmailVerified) {
      await this.sendEmailVerificationOtp(user.id, user.email);
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message:
          'Verify your email address to continue. We have sent a verification code to it.',
        action: 'VERIFY_EMAIL',
        email: user.email,
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
        omit: { passwordHash: true },
      }),
    ]);

    this.logger.log(`Signed in ${user.email}`);

    return {
      success: true,
      message: 'Signed in successfully.',
      data: {
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
    this.logger.debug(`OTP for ${email}: ${otp}`);
  }

  /** 401 for both a missing account and a wrong password — deliberately identical. */
  private invalidCredentials(byEmail = true): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: byEmail
        ? 'That email address and password do not match.'
        : 'That phone number and password do not match.',
      action: 'RETRY',
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
        action: 'RETRY_LATER',
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
        : { userDetail: user, accessToken, refreshToken, nextStep: 'Home' },
    };
  }

  private rejectExistingAccount(
    existing: Pick<User, 'email' | 'phone' | 'status'>,
    email: string,
    phone: string,
  ): never {
    // Suspended and closed accounts answer the same way everywhere, so that
    // wording lives in SharedService. Both of those throw.
    this.sharedService.assertAccountIsUsable(existing.status);

    // Name the field that collided so the client can highlight that input
    // instead of marking the whole form as wrong.
    const emailTaken = existing.email === email;
    const phoneTaken = existing.phone === phone;
    const field =
      emailTaken && phoneTaken ? 'both' : emailTaken ? 'email' : 'phone';
    const label =
      field === 'both'
        ? 'email address and phone number'
        : field === 'email'
          ? 'email address'
          : 'phone number';

    throw new ConflictException({
      code: 'ACCOUNT_ALREADY_EXISTS',
      message: `An account with this ${label} already exists. Sign in instead, or reset your password if you have forgotten it.`,
      action: 'SIGN_IN',
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
        { sub: user.id },
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
