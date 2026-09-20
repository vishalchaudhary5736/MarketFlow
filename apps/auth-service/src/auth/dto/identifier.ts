import { isEmail } from 'class-validator';

/** Same shape registration accepts, so a number can be matched back to its row. */
export const E164_PATTERN = /^\+?[1-9]\d{1,14}$/;

export function isPhoneIdentifier(value: string): boolean {
  return E164_PATTERN.test(value);
}

export function isEmailIdentifier(value: string): boolean {
  return isEmail(value);
}

/**
 * Registration's regex makes the leading `+` optional, so the same number may
 * already be stored either way. Lookups therefore try both spellings rather
 * than assuming the one the caller happened to type.
 */
export function phoneVariants(phone: string): string[] {
  const trimmed = phone.trim();
  const bare = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;

  return [...new Set([trimmed, bare, `+${bare}`])];
}
