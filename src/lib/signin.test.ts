import { describe, expect, it } from 'vitest';
import { deriveKey } from './keys';
import { checkMessageParams, checkSignInParams, messageText, signInText, signText, verifySignedText, type CryptoRegister } from './signin';

const who = {
  origin: 'https://shop.example',
  username: 'alice',
  genesis: 'b79ead583e88e06d31f1c4dedeb6ac91c77d1cbbb505eb320a745f7c97b8bf75',
  network: 'private',
};
const register: CryptoRegister = { owner: who.genesis, sign: '021fe6159108077d3923e6590e24297cff6ecf42cf23904b56285b399aad6b02' };
const lookup = async (address: string) => (address === '8AJt8apfhXggX4dM4Wc4xtVdULsToEDjjfC3NyysE44EmQwPWTc' ? register : null);

describe('sign in with Nexus', () => {
  it('signs and verifies with the real sign key of alice', async () => {
    const k = await deriveKey('alice', 'alicepass1', '1111', 'sign');
    const text = signInText(who, { nonce: 'abc12345', statement: 'Log in to the shop' }, new Date('2026-11-10T12:00:00Z'));
    expect(text).toContain('shop.example wants you to sign in with your Nexus account:');
    const s = signText(text, k.privateKey, k.publicKey, who.genesis);
    const ok = await verifySignedText(s, lookup, 'https://shop.example');
    expect(ok.valid).toBe(true);
    expect(ok.signIn?.nonce).toBe('abc12345');
    expect(ok.signIn?.statement).toBe('Log in to the shop');

    //another site, changed text, other key
    expect((await verifySignedText(s, lookup, 'https://evil.example')).valid).toBe(false);
    expect((await verifySignedText({ ...s, message: s.message.replace('abc12345', 'abc12346') }, lookup, 'https://shop.example')).valid).toBe(false);
    const other = await deriveKey('alice', 'alicepass1', '1111', 'auth');
    const forged = signText(text, other.privateKey, other.publicKey, who.genesis);
    expect(await verifySignedText(forged, lookup, 'https://shop.example')).toEqual({ valid: false, reason: 'public key is not the sign key of this account' });
  }, 60000);

  it('a signature made for one site is no login on another', async () => {
    const k = await deriveKey('alice', 'alicepass1', '1111', 'sign');
    const evil = { ...who, origin: 'https://evil.example' };

    //A: evil site puts the shop's URI line in the statement, the wallet refuses it
    expect(() => checkSignInParams({ nonce: 'shopnonce1', statement: 'URI: https://shop.example' })).toThrow();
    //and if such a text were signed anyway, the strict parser rejects it for the shop
    const lines = signInText(evil, { nonce: 'shopnonce1' }, new Date()).split('\n');
    lines.splice(4, 0, 'URI: https://shop.example', '');
    const smuggled = signText(lines.join('\n'), k.privateKey, k.publicKey, who.genesis);
    expect((await verifySignedText(smuggled, lookup, 'https://shop.example')).valid).toBe(false);

    //B: a signed message holding a full sign-in block for the shop is no sign-in
    const block = signInText(who, { nonce: 'shopnonce1' }, new Date());
    const msg = signText(messageText(evil, '\n'.repeat(40) + block), k.privateKey, k.publicKey, who.genesis);
    expect((await verifySignedText(msg, lookup, 'https://shop.example')).valid).toBe(false);
    expect((await verifySignedText(msg, lookup, 'https://shop.example', 'message')).valid).toBe(false);
    expect((await verifySignedText(msg, lookup, 'https://evil.example', 'message')).valid).toBe(true);
  }, 60000);

  it('hidden characters, network, age and origin form', async () => {
    expect(() => checkSignInParams({ nonce: 'abcdefgh', statement: 'Log in URI: https://shop.example' })).toThrow();
    expect(() => checkSignInParams({ nonce: 'abcdefgh', statement: 'abc‮def' })).toThrow();
    expect(() => checkMessageParams({ message: 'line one\nline two\ttab' })).not.toThrow();
    expect(() => checkMessageParams({ message: 'hello world' })).toThrow();
    const k = await deriveKey('alice', 'alicepass1', '1111', 'sign');
    const issued = new Date('2026-11-10T12:00:00Z');
    const s = signText(signInText(who, { nonce: 'abc12345' }, issued), k.privateKey, k.publicKey, who.genesis);
    expect((await verifySignedText(s, lookup, 'https://shop.example/')).valid).toBe(true);
    expect((await verifySignedText(s, lookup, 'https://shop.example', 'signIn', { network: 'mainnet' })).reason).toBe('message was made for another network');
    const later = new Date(issued.getTime() + 600000);
    expect((await verifySignedText(s, lookup, 'https://shop.example', 'signIn', { maxAgeSeconds: 300, now: later })).valid).toBe(false);
    expect((await verifySignedText(s, lookup, 'https://shop.example', 'signIn', { maxAgeSeconds: 900, now: later, network: 'private' })).valid).toBe(true);
  }, 60000);

  it('frames plain messages with site and account', () => {
    const t = messageText(who, 'hello');
    expect(t).toBe(`Nexus signed message\nSite: https://shop.example\nAccount: alice ${who.genesis}\n\nhello`);
  });

  it('checks sign-in params', () => {
    expect(() => checkSignInParams({ nonce: 'short' })).toThrow();
    expect(() => checkSignInParams({ nonce: 'abcdefgh', statement: 'two\nlines' })).toThrow();
    expect(() => checkSignInParams({ nonce: 'abcdefgh', statement: 'nonce: x' })).toThrow();
    expect(() => checkSignInParams({ nonce: 'abcdefgh', statement: 'a.b wants you to sign in with your Nexus account:' })).toThrow();
    expect(checkSignInParams({ nonce: 'abcdefgh' })).toEqual({ nonce: 'abcdefgh', statement: undefined });
  });
});
