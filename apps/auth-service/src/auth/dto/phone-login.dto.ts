import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { E164_PATTERN } from './identifier';

export class PhoneLoginDto {
  @IsString()
  @MinLength(10)
  @MaxLength(15)
  @Matches(E164_PATTERN, {
    message: 'Phone number must be in E.164 format',
  })
  phone: string;

  // Four digits, matching OTP_LENGTH in SharedService. A string, not a number,
  // because leading zeros are significant.
  @IsString()
  @Matches(/^\d{4}$/, { message: 'otp must be exactly 4 digits' })
  otp: string;
}
