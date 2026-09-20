import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { randomUUID } from 'crypto';
import { CacheService } from '../lib/cacheService/cache.service';
import { OTP_TYPE } from './constants.service';

const BCRYPT_ROUNDS = 12;

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

@Injectable()
export class AuthService {
  private readonly accessSecret = process.env.JWT_ACCESS_SECRET;
  private readonly refreshSecret = process.env.JWT_REFRESH_SECRET;
  private readonly BY_PASS_EMAIL_VERIFICATION =
    process.env.BY_PASS_EMAIL_VERIFICATION;

  constructor(
    private readonly cacheService: CacheService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // role defaults to CUSTOMER and status to INACTIVE at the schema level,
  // so a new account exists but cannot sign in until it is verified.
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
      const isExistUser = await this.prisma.user.findFirst({
        where: { OR: [{ email }, { phone }] },
        select: {
          email: true,
          phone: true,
          status: true,
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

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      user = await this.prisma.user.create({
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
      throw this.translateKnownErrors(error);
    }

    // TO DO: Send verification email with a link to the frontend that includes a
    if (this.BY_PASS_EMAIL_VERIFICATION !== 'true') {
    }

    return {
      success: true,
      message: 'Account created successfully. Otp sent to your ',
      data: { email: user.email, nextStep: 'VERIFY_EMAIL' },
    };
  }

  async resendOtp({ otpType, email }: { otpType: OTP_TYPE; email: string }) {
    try {
      // TO DO (use redis)
      email = email.trim().toLowerCase();

      const isExistUser = await this.prisma.user.findFirst({
        where: { email },
        select: {
          email: true,
          phone: true,
          status: true,
          isEmailVerified: true,
        },
      });

      if (!isExistUser) {
        throw new BadGatewayException('Email not configured with any account!');
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
          console.info('Invalid otpType');
          throw new BadGatewayException('Invalid otpType');
      }
    } catch (error) {
      throw this.translateKnownErrors(error);
    }
  }

  // Every rejection carries a stable `code` the client switches on, a `message`
  // that tells the person what to do next, and an `action` naming the button to
  // offer them. Wording can then change freely without breaking the frontend.
  private rejectExistingAccount(
    existing: Pick<User, 'email' | 'phone' | 'status'>,
    email: string,
    phone: string,
  ): never {
    switch (existing.status) {
      case UserStatus.BLOCKED:
        // 403 rather than 409: the details are not the problem, the account is.
        throw new ForbiddenException({
          code: 'ACCOUNT_SUSPENDED',
          message:
            'This account has been suspended and cannot be used to sign up again. Contact our support team if you believe this is a mistake.',
          action: 'CONTACT_SUPPORT',
        });

      case UserStatus.DELETED:
        // 410 Gone: the account existed and was intentionally retired.
        throw new GoneException({
          code: 'ACCOUNT_CLOSED',
          message:
            'This account was closed. Reset your password to reopen it, or contact our support team to sign up with these details again.',
          action: 'RESTORE_ACCOUNT',
        });

      default: {
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
    }
  }

  // Signed with two different secrets so a leaked access token can never be
  // replayed against the refresh endpoint to mint a fresh pair.
  private async issueTokens(
    user: PublicUser,
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

  // Reached only when two registrations for the same details race past the
  // lookup above, so it mirrors ACCOUNT_ALREADY_EXISTS rather than exposing a
  // raw Prisma error as a 500.
  private translateKnownErrors(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      console.error('Prisma error:', error);
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
    console.error('error:', error);
    return error;
  }
}
