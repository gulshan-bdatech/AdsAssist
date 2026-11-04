import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * AES-256-GCM for OAuth tokens at rest. Same format and key derivation as the
 * old adassist app (`v1:<iv>:<tag>:<ciphertext>`), so its encrypted tokens
 * decrypt here with the same TOKEN_ENCRYPTION_KEY.
 */
const SALT = 'adsassist-token-v1';
const PREFIX = 'v1:';

let cachedKey: { raw: string; key: Buffer } | null = null;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY ?? '';
  if (raw.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 characters');
  if (cachedKey?.raw !== raw) cachedKey = { raw, key: scryptSync(raw, SALT, 32) };
  return cachedKey.key;
}

export function encryptToken(plaintext: string | null | undefined): string {
  if (!plaintext) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptToken(encoded: string | null | undefined): string {
  if (!encoded) return '';
  if (!encoded.startsWith(PREFIX)) throw new Error('Token is not encrypted with the v1 format');
  const [iv, tag, ct] = encoded.slice(PREFIX.length).split(':');
  if (!iv || !tag || !ct) throw new Error('Malformed encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}
