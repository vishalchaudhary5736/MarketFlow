import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'otp must be exactly 4 digits' })
  otp: string;

  // Same floor registration enforces, so a reset cannot weaken a password
  // below what signing up would have accepted.
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
