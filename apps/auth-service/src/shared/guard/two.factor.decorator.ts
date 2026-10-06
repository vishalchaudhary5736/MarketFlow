import { SetMetadata } from '@nestjs/common';

export type TokenType = 'access' | '2fa_setup' | '2fa_verify';

export const TOKEN_TYPE_KEY = 'tokenType';

/** Marks a route as accepting ONLY a temporary 2FA token of this type. */
export const TwoFactorStep = (type: Exclude<TokenType, 'access'>) =>
  SetMetadata(TOKEN_TYPE_KEY, type);
