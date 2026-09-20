import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  // bcrypt silently ignores anything past 72 bytes, so cap it rather than
  // letting users believe a longer password is doing something.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @Length(1, 100)
  firstName: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @IsOptional()
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'phone must be a valid E.164-style number',
  })
  phone?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  avatarUrl?: string;
}
