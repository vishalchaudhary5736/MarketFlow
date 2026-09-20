import { IsEmail, IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { OTP_TYPE, VERIFICATION_OTP_TYPES } from '../constants.service';

export class VerifyOtpDto {
  @IsIn(VERIFICATION_OTP_TYPES, {
    message: `otpType must be one of: ${VERIFICATION_OTP_TYPES.join(', ')}`,
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
