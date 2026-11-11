import { describe, expect, it } from 'vitest';
import { formatAmount, isRecipient, isReference, parseAmount, shortHash } from './format';

describe('parseAmount', () => {
  it('accepts plain and comma decimals', () => {
    expect(parseAmount('12.5', 6)).toBe(12.5);
    expect(parseAmount('12,5', 6)).toBe(12.5);
    expect(parseAmount(' 7 ', 0)).toBe(7);
  });

  it('rejects bad input', () => {
    expect(parseAmount('', 6)).toBeNull();
    expect(parseAmount('0', 6)).toBeNull();
    expect(parseAmount('-1', 6)).toBeNull();
    expect(parseAmount('1e5', 6)).toBeNull();
    expect(parseAmount('1.234', 2)).toBeNull();
    expect(parseAmount('abc', 6)).toBeNull();
  });
});

describe('recipients', () => {
  it('accepts addresses and names', () => {
    expect(isRecipient('8BoheBPAFeWSKKSzWuQLxVbVz8wbKW6ZVLmgLU2mmUA9xp5FHkb')).toBe(true);
    expect(isRecipient('alice:main')).toBe(true);
    expect(isRecipient('space::name')).toBe(true);
    expect(isRecipient('TESTT')).toBe(true);
  });

  it('rejects empty and spaced input', () => {
    expect(isRecipient('')).toBe(false);
    expect(isRecipient('a b')).toBe(false);
    expect(isRecipient('a:::b')).toBe(false);
  });
});

describe('isReference', () => {
  it('allows empty and 64 bit numbers', () => {
    expect(isReference('')).toBe(true);
    expect(isReference('18446744073709551615')).toBe(true);
    expect(isReference('18446744073709551616')).toBe(false);
    expect(isReference('12a')).toBe(false);
  });
});

describe('display', () => {
  it('formats amounts and hashes', () => {
    expect(formatAmount(1234.5, 6)).toBe('1,234.5');
    expect(formatAmount(undefined)).toBe('0');
    expect(shortHash('0123456789abcdef0123', 4)).toBe('0123...0123');
    expect(shortHash('short')).toBe('short');
  });
});
