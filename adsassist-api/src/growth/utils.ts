import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

export function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  return `+${e164.slice(0, 2)}${'*'.repeat(Math.max(0, e164.length - 6))}${e164.slice(-4)}`;
}

/** True for loopback, private, link-local, CGNAT and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/** `t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}
