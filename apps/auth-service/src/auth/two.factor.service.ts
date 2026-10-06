import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type { Response } from 'express';
import { User, UserRole } from '../../../../generated/prisma/client';
import { SharedService } from '../shared/shared.service';
import * as bcrypt from 'bcryptjs';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCode,
} from '../shared/crypto.util';
import { AuthService } from './auth.service';

const totp = authenticator.clone({ window: 1 });
const RECOVERY_CODE_COUNT = 10;

const TWO_FACTOR_ISSUER = process.env.TWO_FACTOR_ISSUER ?? 'E-commerce Admin';

@Injectable()
export class TwoFaService {
  constructor(
    private readonly sharedService: SharedService,
    private readonly authService: AuthService,
  ) {}

  async twoFaSetup(adminId: string) {
    const admin = await this.findAdmin(adminId);
    if (admin.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    const secret = totp.generateSecret();

    await this.sharedService.prisma.user.update({
      where: { id: admin.id },
      data: {
        twoFactorSecret: encryptSecret(secret),
        twoFactorSetupCompleted: false,
      },
    });

    const otpauthUrl = totp.keyuri(admin.email, TWO_FACTOR_ISSUER, secret);

    return {
      success: true,
      message: 'Scan the QR code with your authenticator app.',
      data: {
        qrCode: await QRCode.toDataURL(otpauthUrl),
        otpauthUrl,
        manualEntryKey: secret,
      },
    };
  }

  /**
   * Confirms the pending secret with the first code from the app, turns 2FA
   * on and signs the admin in.
   */
  async confirmSetup(
    adminId: string,
    code: string,
    userAgent: string | undefined,
    res: Response,
  ) {
    const admin = await this.findAdmin(adminId);
    if (admin.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }
    if (!admin.twoFactorSecret) {
      throw new BadRequestException('Start 2FA setup first');
    }
    console.log('data=>>>>>>>>>>>>>>>>>>>>', admin);
    this.assertValidCode(admin.twoFactorSecret, code);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      generateRecoveryCode(),
    );

    const hashRecoveryCode = await Promise.all(
      recoveryCodes.map(async (recoveryCode) => ({
        userId: admin.id,
        codeHash: await bcrypt.hash(recoveryCode, 12),
      })),
    );

    await this.sharedService.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: admin.id },
        data: { twoFactorEnabled: true, twoFactorSetupCompleted: true },
      });

      await tx.recoveryCode.deleteMany({
        where: { userId: admin.id },
      });

      await tx.recoveryCode.createMany({
        data: hashRecoveryCode,
      });
    });

    const loginResult = await this.authService.completeAdminLogin(
      admin,
      userAgent,
      res,
    );

    return {
      ...loginResult,
      data: {
        ...loginResult.data,
        recoveryCodes: {
          message:
            'Save these recovery codes securely. Each code can only be used once.',
          codes: recoveryCodes,
        },
      },
    };
  }

  /** Second step of sign-in for an admin who already has 2FA enabled. */
  async verifyLogin(
    adminId: string,
    code: string,
    userAgent: string | undefined,
    res: Response,
  ) {
    const admin = await this.findAdmin(adminId);
    if (!admin.twoFactorEnabled || !admin.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    this.assertValidCode(admin.twoFactorSecret, code);

    return this.authService.completeAdminLogin(admin, userAgent, res);
  }

  private async findAdmin(adminId: string): Promise<User> {
    const admin = await this.sharedService.prisma.user.findUnique({
      where: { id: adminId },
    });
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new UnauthorizedException();
    }
    // The temp token outlives a status change, so check again here.
    this.sharedService.assertAccountIsUsable(admin.status);
    return admin;
  }

  private assertValidCode(sealedSecret: string, code: string): void {
    const valid = totp.verify({
      token: code,
      secret: decryptSecret(sealedSecret),
    });
    if (!valid) {
      throw new UnauthorizedException('Invalid authentication code');
    }
  }

  async recoveryLogin(
    adminId: string,
    recoveryCode: string,
    res: Response,
    userAgent?: string,
  ) {
    const admin = await this.findAdmin(adminId);

    if (!admin?.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    const normalizeCode = recoveryCode.trim().toUpperCase();

    const recoveryCodes = await this.sharedService.prisma.recoveryCode.findMany(
      {
        where: {
          userId: admin.id,
          usedAt: null,
        },
      },
    );

    let matchedCodeId: string | null = null;

    for (const recoveryCodeRecord of recoveryCodes) {
      const isMatch = await bcrypt.compare(
        normalizeCode,
        recoveryCodeRecord.codeHash,
      );
      if (isMatch) {
        matchedCodeId = recoveryCodeRecord.id;
        break;
      }
    }

    if (!matchedCodeId) {
      throw new UnauthorizedException('Invalid or already used recovery code');
    }

    const consumed = await this.sharedService.prisma.recoveryCode.updateMany({
      where: {
        id: matchedCodeId,
        userId: admin.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    if (consumed.count !== 1) {
      throw new UnauthorizedException('Invalid or already used recovery code');
    }

    return this.authService.completeAdminLogin(admin, userAgent, res);
  }

  async resetTwoFactor(adminId: string) {
    const admin = await this.findAdmin(adminId);

    if (!admin?.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    await this.sharedService.prisma.$transaction([
      this.sharedService.prisma.user.update({
        where: {
          id: admin.id,
        },
        data: {
          twoFactorEnabled: false,
          twoFactorSetupCompleted: false,
          twoFactorSecret: null,
        },
      }),

      this.sharedService.prisma.recoveryCode.deleteMany({
        where: {
          userId: admin.id,
        },
      }),
    ]);

    return {
      success: true,
      message: '2FA has been reset. Please set up your authenticator again.',
    };
  }
}
