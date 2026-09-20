import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Lets the client check the code before it shows the new-password form.
 * Optional in the flow: /auth/reset-password validates the code again, so a
 * client may go straight there.
 */
export class VerifyResetOtpDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  // Four digits, matching OTP_LENGTH in SharedService. A string, not a number,
  // because leading zeros are significant.
  @IsString()
  @Matches(/^\d{4}$/, { message: 'otp must be exactly 4 digits' })
  otp: string;
}
