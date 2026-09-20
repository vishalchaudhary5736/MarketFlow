import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { OTP_TYPE } from './constants.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  registerCustomer(@Body() dto: CustomerRegisterDto) {
    return this.authService.registerCustomer(dto);
  }
  
  @Post('resend-otp')
  resendOtp(@Body() dto: { otpType:OTP_TYPE, email :string}) {
    return this.authService.resendOtp(dto);
  }
}
