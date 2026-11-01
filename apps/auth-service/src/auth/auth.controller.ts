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
import { AuthService } from './auth.service';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CheckEmailMobileDto } from './dto/checkEmailMobile.dto';
import type { Request, Response } from 'express';
import type { extendRequest } from '../shared/shared.types';
import { LogoutDto } from './dto/logout.dto';
import { AuthGaurd } from '../shared/guard/auth.gaurd';
import { RolesGuard } from '../shared/guard/roles.guard';
import { Public } from '../shared/guard/public.decorator';

@UseGuards(AuthGaurd, RolesGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  registerCustomer(@Body() dto: CustomerRegisterDto) {
    return this.authService.registerCustomer(dto);
  }

  @Public()
  @Post('check-email-mobile')
  @HttpCode(HttpStatus.OK)
  checkEmail(@Body() dto: CheckEmailMobileDto) {
    return this.authService.checkEmailMobile(dto);
  }

  @Public()
  @Post('resend-otp')
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Public()
  @Post('verify-otp')
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent')
    userAgent?: string,
  ) {
    return this.authService.verifyOtp(dto, userAgent, res);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(dto, userAgent, res);
  }

  // No body: the refresh token comes from the httpOnly cookie set at sign-in.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.refresh(
      req.cookies?.refreshToken as string | undefined,
      userAgent,
      res,
    );
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.authService.verifyPasswordResetOtp(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(
    @Req() req: extendRequest,
    @Body() dto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.logout(req.user, dto, res);
  }
}
