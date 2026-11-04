import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPrivateAddress, maskEmail, maskPhone, signPayload } from './utils.js';

describe('webhook SSRF guard', () => {
  it('flags private and loopback addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '203.0.113.9', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('webhook signature', () => {
  it('signs "<t>.<body>" with HMAC-SHA256', () => {
    const body = '{"event":"ping"}';
    const sig = signPayload('whsec_test', body, 1700000000);
    const expected = createHmac('sha256', 'whsec_test').update(`1700000000.${body}`).digest('hex');
    expect(sig).toBe(`t=1700000000,v1=${expected}`);
  });
});

describe('audience masking', () => {
  it('masks email and phone for previews', () => {
    expect(maskEmail('priya@example.com')).toBe('pr***@example.com');
    expect(maskPhone('919876543210')).toBe('+91******3210');
    expect(maskEmail(null)).toBeNull();
  });
});
