import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'atLeastOneField', async: false })
export class AtLeastOneFieldConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const object = args.object as Record<string, unknown>;

    return Object.values(object).some(
      (value) => value !== undefined && value !== null && value !== '',
    );
  }

  defaultMessage() {
    return 'At least one field must be provided';
  }
}
export class UpdateProfile {
  @Validate(AtLeastOneFieldConstraint)
  private readonly atLeastOneField!: boolean;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => {
    typeof value === 'string' ? value.trim() : value;
  })
  @IsNotEmpty()
  @Length(9, 15)
  @Matches(/^[0-9]+$/, {
    message: 'Value must contain only numeric digits',
  })
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => {
    typeof value === 'string' ? value.trim() : value;
  })
  @Length(1, 5)
  countryCode?: string;

  @IsOptional()
  @Transform(({ value }) => {
    typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @IsOptional()
  @Transform(({ value }) => {
    typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @IsOptional()
  @Transform(({ value }) => {
    typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @IsNotEmpty()
  avatarUrl?: string;
}
