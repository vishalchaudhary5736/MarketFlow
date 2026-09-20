import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  registerCustomer(@Body() dto: CustomerRegisterDto) {
    return this.authService.registerCustomer(dto);
  }

  @Post('resend-otp')
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('verify-otp')
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.verifyOtp(dto, userAgent);
  }

  // 200, not the 201 a @Post defaults to: signing in does not create a user.
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
  }
}
