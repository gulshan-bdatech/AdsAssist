import { createHash, randomBytes } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = (email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/**
 * Normalises a phone number to E.164 digits (no "+"), e.g. "98765 43210" with
 * country code 91 → "919876543210". Numbers that already carry a country code
 * ("+1 415…", "0091…") keep it. Returns null for anything too short to be real.
 *
 * Both identity matching and the ad platforms use this one form, so a lead
 * captured by the pixel and the same lead pushed by a CRM hash identically.
 */
export function normalizePhone(phone: string | null | undefined, defaultCountryCode = '91'): string | null {
  const raw = (phone ?? '').trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else {
    digits = digits.replace(/^0+/, '');
    const cc = defaultCountryCode.replace(/\D/g, '');
    // A national number is 10 digits in most markets this targets (IN, US).
    if (digits.length <= 10 && cc) digits = cc + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export const emailHash = (normalizedEmail: string) => sha256(normalizedEmail);

/** Meta wants SHA-256 of digits with country code and no "+". */
export const metaPhoneHash = (e164Digits: string) => sha256(e164Digits);

/** Google wants SHA-256 of E.164 including the leading "+". */
export const googlePhoneHash = (e164Digits: string) => sha256(`+${e164Digits}`);

/** Identity key for phone; same as Meta's form. */
export const phoneHash = metaPhoneHash;

/**
 * Generates a public/secret key with a readable prefix. Only the SHA-256 is
 * stored; `prefix` (first 12 chars) is kept so users can tell keys apart.
 */
export function generateKey(prefix: 'aa' | 'aak' | 'inv'): { key: string; hash: string; keyPrefix: string } {
  const key = `${prefix}_${randomBytes(24).toString('base64url')}`;
  return { key, hash: sha256(key), keyPrefix: key.slice(0, prefix.length + 9) };
}
