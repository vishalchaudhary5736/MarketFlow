import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
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
  @Matches(/^\+[1-9]\d{0,2}$/, {
    message: 'Country code must be "+" followed by 1-3 digits, e.g. +91',
  })
  countryCode: string;

  @IsString()
  @MinLength(4)
  @MaxLength(14)
  @Matches(/^\d+$/, {
    message: 'Phone number must contain digits only',
  })
  mobileNumber: string;

  @IsBoolean()
  @IsNotEmpty()
  agreeTerms: boolean;
}
