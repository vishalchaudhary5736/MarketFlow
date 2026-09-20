import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  /**
   * Ends every session on the account rather than only the calling one.
   * Defaults to false, so signing out on a phone leaves a laptop signed in.
   */
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
