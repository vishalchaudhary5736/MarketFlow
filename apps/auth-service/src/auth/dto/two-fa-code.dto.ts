import { IsString, Matches } from 'class-validator';

export class TwoFaCodeDto {
  // Six digits from the authenticator app. Kept as a string so leading zeros
  // survive.
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code: string;
}
