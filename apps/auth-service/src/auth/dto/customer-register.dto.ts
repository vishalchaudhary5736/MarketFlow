import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CustomerRegisterDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MaxLength(100)
  @MinLength(1)
  firstName: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(10)
  @MaxLength(15)
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone number must be in E.164 format',
  })
  phone: string;
}
