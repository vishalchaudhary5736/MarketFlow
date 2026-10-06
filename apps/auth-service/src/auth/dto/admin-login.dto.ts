import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AdminLogin {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  // MinLength, not Min: Min compares numbers and rejects every string.
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password should be at least 8 characters' })
  @MaxLength(128)
  password: string;
}
