import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminLogin } from './dto/admin-login.dto';
import { AuthService } from './auth.service';
import type { Response } from 'express';
import { AuthGaurd } from '../shared/guard/auth.gaurd';
import { RolesGuard } from '../shared/guard/roles.guard';
import { Public } from '../shared/guard/public.decorator';
import { TwoFactorStep } from '../shared/guard/two.factor.decorator';
import { TwoFaService } from './two.factor.service';
import { TwoFaRecoveryDto } from './dto/2fa-recovery.dto';
import { TwoFaCodeDto } from './dto/two-fa-code.dto';
import { LogoutDto } from './dto/logout.dto';
import { Reflector } from '@nestjs/core';
import type { adminPRequest } from '../shared/shared.types';

const STRICT_LIMIT = { default: { limit: 5, ttl: 60_000 } };

@Controller('admin/auth')
@UseGuards(AuthGaurd, RolesGuard)
// @UseGuards(ThrottlerGuard)
export class AdminAuthcontroller {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFaService: TwoFaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_LIMIT)
  loginAdmin(
    @Body() dto: AdminLogin,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.adminLogin(dto, userAgent, res);
  }

  @TwoFactorStep('2fa_setup')
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  twofaSetup(@Req() req) {
    return this.twoFaService.twoFaSetup(req.user.sub);
  }

  @TwoFactorStep('2fa_setup')
  @Post('2fa/setup-confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_LIMIT)
  twofaConfirmSetup(
    @Req() req,
    @Body() dto: TwoFaCodeDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.twoFaService.confirmSetup(
      req.user.sub,
      dto.code,
      userAgent,
      res,
    );
  }

  @TwoFactorStep('2fa_verify')
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_LIMIT)
  twofaVerify(
    @Req() req,
    @Body() dto: TwoFaCodeDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.twoFaService.verifyLogin(
      req.user.sub,
      dto.code,
      userAgent,
      res,
    );
  }

  @TwoFactorStep('2fa_verify')
  @Post('2fa/recovery')
  @Throttle(STRICT_LIMIT)
  twoFaRecovery(
    @Req() req,
    @Body() dto: TwoFaRecoveryDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.twoFaService.recoveryLogin(
      req.user.sub,
      dto.code,
      res,
      userAgent,
    );
  }

  @Post('2fa/reset')
  async resetTwoFactor(@Req() req) {
    return this.twoFaService.resetTwoFactor(req.user.sub);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_LIMIT)
  logoutAdmin(
    @Req() req: adminPRequest,
    @Body() dto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.logout(req.user, dto, res);
  }
}
