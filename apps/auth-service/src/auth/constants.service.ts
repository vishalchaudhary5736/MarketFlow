import { UserRole } from '../../../../generated/prisma/enums';

export enum OTP_TYPE {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  MOBILE_VERIFICATION = 'MOBILE_VERIFICATION',
  PHONE_LOGIN = 'PHONE_LOGIN',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

export const VERIFICATION_OTP_TYPES = [
  OTP_TYPE.EMAIL_VERIFICATION,
  OTP_TYPE.MOBILE_VERIFICATION,
  OTP_TYPE.PASSWORD_RESET,
] as const;

export const NAVIGATION_SCREENS = {
  OTP_SCREEN_FOR_VERIFY_EMAIL: 'OTP_SCREEN',
  LOGIN_SCREEN: 'LOGIN_SCREEN',
  PASSWORD_RESET: 'PASSWORD_RESET',
  DASHBOARD: 'DASHBOARD',
  TWO_FA_SETUP: 'TWO_FA_SETUP',
  TWO_FA_VERIFICATION: 'TWO_FA_VERIFICATION',
};

export enum TokenPurpose {
  ACCESS = 'access',
  REFRESH = 'refresh',
  TWO_FA_SETUP = '2fa_setup',
  TWO_FA_VERIFY = '2fa_verify',
}

export interface TempJwtPayload {
  sub: string;
  role: UserRole;
  purpose: TokenPurpose;
  jti?: string;
}
