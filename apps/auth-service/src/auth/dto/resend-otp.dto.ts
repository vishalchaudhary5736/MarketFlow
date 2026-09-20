import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { OTP_TYPE, VERIFICATION_OTP_TYPES } from '../constants.service';

// A class, not an inline type: ValidationPipe skips plain object types, so an
// unrecognised otpType used to reach the service untouched and surface as a 502
// from the switch default. With this it is rejected as a 400 at the boundary.
export class ResendOtpDto {
  @IsIn(VERIFICATION_OTP_TYPES, {
    message: `otpType must be one of: ${VERIFICATION_OTP_TYPES.join(', ')}`,
  })
  otpType: OTP_TYPE;

  @IsEmail()
  @MaxLength(255)
  email: string;
}
