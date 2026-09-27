import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

type LoginContact = {
  email?: string;
  countryCode?: string;
  mobileNumber?: string;
};

const hasPhoneField = (o: LoginContact) =>
  o.countryCode != null || o.mobileNumber != null;

/**
 * Sign in with `email`, or with `countryCode` + `mobileNumber` together.
 * Sending only one of the two phone fields is rejected.
 */
export class LoginDto {
  // Checked when sent, or when there is no phone to fall back on.
  @ValidateIf((o: LoginContact) => o.email != null || !hasPhoneField(o))
  @IsNotEmpty({
    message: 'Provide email, or both countryCode and mobileNumber',
  })
  @IsEmail()
  @MaxLength(255)
  email?: string;

  // Required when there is no email, or when mobileNumber is sent.
  @ValidateIf((o: LoginContact) => o.email == null || hasPhoneField(o))
  @IsNotEmpty({ message: 'countryCode is required with mobileNumber' })
  @IsString()
  @Matches(/^\+[1-9]\d{0,2}$/, {
    message: 'Country code must be "+" followed by 1-3 digits, e.g. +91',
  })
  countryCode?: string;

  // Required when there is no email, or when countryCode is sent.
  @ValidateIf((o: LoginContact) => o.email == null || hasPhoneField(o))
  @IsNotEmpty({ message: 'mobileNumber is required with countryCode' })
  @IsString()
  @MinLength(4)
  @MaxLength(14)
  @Matches(/^\d+$/, {
    message: 'Phone number must contain digits only',
  })
  mobileNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;

  @IsBoolean()
  @IsNotEmpty()
  remember: boolean;
}
