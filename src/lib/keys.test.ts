import { describe, expect, it } from 'vitest';
import { cryptoRegisterAddress, deriveKey, genesisOf } from './keys';

//values the core wrote on the private test chain for user alice (password alicepass1, PIN 1111)
const alice = {
  genesis: 'b79ead583e88e06d31f1c4dedeb6ac91c77d1cbbb505eb320a745f7c97b8bf75',
  auth: '0245c601c046c8bbc62bafe5914e897fb30413ea34fc1e35c344313ae9c71c8e',
  network: '02bd71bcfe6c3fffa288aeef0e79b0b1c31056a325bdffbf999a7cc5878c0bb9',
  sign: '021fe6159108077d3923e6590e24297cff6ecf42cf23904b56285b399aad6b02',
};

describe('keys like the core', () => {
  it('genesis of a username (type byte set by the node)', async () => {
    expect((await genesisOf('alice')).slice(2)).toBe(alice.genesis.slice(2));
  }, 60000);

  it('crypto register key hashes', async () => {
    for (const type of ['auth', 'network', 'sign'] as const) {
      const k = await deriveKey('alice', 'alicepass1', '1111', type);
      expect(k.hash, type).toBe(alice[type]);
    }
  }, 120000);

  it('crypto register address from the genesis', () => {
    expect(cryptoRegisterAddress(alice.genesis)).toBe('8AJt8apfhXggX4dM4Wc4xtVdULsToEDjjfC3NyysE44EmQwPWTc');
  });

  it('wrong PIN gives another key', async () => {
    const k = await deriveKey('alice', 'alicepass1', '1112', 'sign');
    expect(k.hash).not.toBe(alice.sign);
  }, 60000);
});
