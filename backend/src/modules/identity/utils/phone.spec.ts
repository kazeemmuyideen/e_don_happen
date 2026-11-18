import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it('canonicalises Nigerian local numbers', () => {
    expect(normalizePhone('0800 000 0001')).toBe('+2348000000001');
    expect(normalizePhone('2348000000001')).toBe('+2348000000001');
  });

  it('preserves E.164 numbers and strips formatting', () => {
    expect(normalizePhone('+234 (800) 000-0002')).toBe('+2348000000002');
    expect(normalizePhone('+1-202-555-0143')).toBe('+12025550143');
  });

  it('rejects invalid numbers', () => {
    expect(() => normalizePhone('123')).toThrow();
    expect(() => normalizePhone('+0123')).toThrow();
  });
});
