import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Sortable, URL-safe id: millisecond timestamp in base36 + randomness.
 * Sorting by id therefore sorts by creation time, which keeps exports stable.
 */
export function newId(prefix = ''): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const bytes = crypto.randomBytes(8);
  let random = '';
  for (const byte of bytes) random += ALPHABET[byte % ALPHABET.length];
  return `${prefix}${time}${random}`;
}

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
