import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '../../../../generated/prisma/client';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { OTP_TYPE } from './constants.service';
import { SharedService } from '../shared/shared.service';
import { AuthTokens, JwtPayload, PublicUser } from '../shared/shared.types';

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
          id:true,
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

  async verifyOtp({
    otpType,
    email,
    otp,
  }: {
    otpType: OTP_TYPE;
    email: string;
    otp: string;
  }) {
    email = email.trim().toLowerCase();
    otp = otp.trim();

    const user = await this.sharedService.prisma.user.findUnique({
      where: { email },
      select: {
        email: true,
        id:true,
        status: true,
        isEmailVerified: true,
        phoneVerifiedAt: true,
      },
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
      return this.verificationSucceeded(otpType, user.email, true);
    }

    if (this.BY_PASS_EMAIL_VERIFICATION !== 'true') {
      await this.sharedService.assertOtpIsValid(otpType, user.id, otp);
    }

    const applied = await this.markVerified(otpType, user.email);

    if (!applied) {
      return this.verificationSucceeded(otpType, user.id, true);
    }

    // Single use: burn the code so it cannot be replayed.
    await this.sharedService.deleteOtp(otpType, user.id);

    this.logger.log(`Verified ${otpType} for ${user.email}`);

    return this.verificationSucceeded(otpType, user.email, false);
  }

  private isAlreadyVerified(
    otpType: OTP_TYPE,
    user: Pick<User, 'isEmailVerified' | 'phoneVerifiedAt'>,
  ): boolean {
    return otpType === OTP_TYPE.EMAIL_VERIFICATION
      ? user.isEmailVerified
      : user.phoneVerifiedAt !== null;
  }

  // updateMany rather than update: the precondition sits in the WHERE clause,
  // so checking and writing are a single atomic statement. Two requests
  // carrying the same code cannot both come back as the one that verified.
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
    email: string,
    alreadyDone: boolean,
  ) {
    const subject =
      otpType === OTP_TYPE.EMAIL_VERIFICATION
        ? 'Email address'
        : 'Phone number';

    return {
      success: true,
      message: alreadyDone
        ? `${subject} is already verified. You can sign in.`
        : `${subject} verified successfully. You can now sign in.`,
      data: { email, nextStep: 'LOGIN' },
    };
  }

  // Every rejection carries a stable `code` the client switches on, a `message`
  // that tells the person what to do next, and an `action` naming the button to
  // offer them. Wording can then change freely without breaking the frontend.
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
}
