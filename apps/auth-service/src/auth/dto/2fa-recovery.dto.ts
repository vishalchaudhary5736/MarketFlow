import { IsString, Matches } from 'class-validator';

export class TwoFaRecoveryDto {
  @IsString()
  @Matches(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, {
    message: 'Invalid recovery code format',
  })
  code: string;
}
