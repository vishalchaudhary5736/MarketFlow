export enum OTP_TYPE {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  MOBILE_VERIFICATION = 'MOBILE_VERIFICATION',
  PHONE_LOGIN = 'PHONE_LOGIN',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

/**
 * The types /auth/verify-otp and /auth/resend-otp accept.
 *
 * PHONE_LOGIN and PASSWORD_RESET are deliberately excluded: each has its own
 * endpoints, and keeping them in a separate key namespace means a code issued
 * to sign in or to reset a password cannot be replayed to mark an address
 * verified, or the other way round.
 */
export const VERIFICATION_OTP_TYPES = [
  OTP_TYPE.EMAIL_VERIFICATION,
  OTP_TYPE.MOBILE_VERIFICATION,
] as const;
