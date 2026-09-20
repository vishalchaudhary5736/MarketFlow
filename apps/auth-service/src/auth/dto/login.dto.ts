import {
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateBy,
  ValidationOptions,
} from 'class-validator';
import { isEmailIdentifier, isPhoneIdentifier } from './identifier';

/** Accepts an email address or an E.164 phone number, and nothing else. */
function IsEmailOrPhone(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isEmailOrPhone',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          (isEmailIdentifier(value) || isPhoneIdentifier(value.trim())),
        defaultMessage: () =>
          'identifier must be an email address or a phone number in E.164 format',
      },
    },
    validationOptions,
  );
}

export class LoginDto {
  @IsEmailOrPhone()
  @MaxLength(255)
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
