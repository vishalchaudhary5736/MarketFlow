import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { E164_PATTERN } from './identifier';

export class RequestPhoneOtpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(15)
  @Matches(E164_PATTERN, {
    message: 'Phone number must be in E.164 format',
  })
  phone: string;
}
