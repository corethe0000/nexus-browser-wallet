import { describe, expect, it } from 'vitest';
import { expiryCondition } from './tritium';
import { toHex } from './keys';

const genesis = 'b79ead583e88e06d31f1c4dedeb6ac91c77d1cbbb505eb320a745f7c97b8bf75';
const mem = '75bfb8977c5f740a32eb05b5bb1c7dc791acb6dedec4f1316de0883e58ad9eb7';

describe('expiryCondition', () => {
  it('is byte for byte what the core wrote in a real 7 day send', () => {
    const seven = '803a090000000000';
    expect(toHex(expiryCondition(genesis, 604800))).toBe(`a2c08374${mem}a0cb9073${seven}82c1a3a1a2c08074${mem}a0cb9073${seven}81c1a3`);
  });

  it('never expiring: only not the sender', () => {
    expect(toHex(expiryCondition(genesis, 0))).toBe(`a2c08374${mem}a3`);
  });
});
