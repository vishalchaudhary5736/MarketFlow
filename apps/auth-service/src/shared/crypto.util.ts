import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export function generateUniqueValue(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

// Secrets at rest (e.g. TOTP keys) are sealed with AES-256-GCM. The key is 32
// random bytes, base64-encoded, in TWO_FACTOR_ENCRYPTION_KEY. The stored value
// is `iv.authTag.ciphertext`, each part base64url.
const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const key = Buffer.from(
    process.env.TWO_FACTOR_ENCRYPTION_KEY ?? '',
    'base64',
  );
  if (key.length !== 32) {
    throw new Error(
      'TWO_FACTOR_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    );
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptSecret(sealed: string): string {
  const [iv, tag, encrypted] = sealed
    .split('.')
    .map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv(CIPHER, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}

export function generateRecoveryCode(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let first = '';
  let second = '';

  for (let i = 0; i < 4; i++) {
    first += characters[randomBytes(1)[0] % characters.length];
    second += characters[randomBytes(1)[0] % characters.length];
  }

  return `${first}-${second}`;
}
