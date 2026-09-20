import { IsEmail, IsEnum, IsString, Matches, MaxLength } from 'class-validator';
import { OTP_TYPE } from '../constants.service';

export class VerifyOtpDto {
  @IsEnum(OTP_TYPE, {
    message: `otpType must be one of: ${Object.values(OTP_TYPE).join(', ')}`,
  })
  otpType: OTP_TYPE;

  @IsEmail()
  @MaxLength(255)
  email: string;

  // Exactly six digits, matching SharedService.generateOtp. Leading zeros are
  // significant, so this is a string with a pattern rather than a number.
  @IsString()
  @Matches(/^\d{4}$/, { message: 'otp must be exactly 4 digits' })
  otp: string;
}
