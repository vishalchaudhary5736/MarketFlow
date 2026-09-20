import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  // No MinLength here even though registration requires 8. Length rules belong
  // to the password being *set*; enforcing them at sign-in would lock out any
  // account created before the rule tightened, and a short password is already
  // going to fail the hash comparison.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
