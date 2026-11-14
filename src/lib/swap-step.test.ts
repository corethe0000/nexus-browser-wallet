import { describe, expect, it } from 'vitest';
import { checkSwapStep } from './swap-step';

const now = 1800000000;
const acct = '8BRYHSJy3dS5ahFPKsMuggjpGZ1EG4Ab9WB5K7sjDMFZVzw4rqk';
const genesis = 'b1' + 'ab'.repeat(31);
const h = 'cd'.repeat(32);
const lock = { step: 'lock', from: acct, to: acct, amount: '400', recipient: genesis, hashlock: `0x${h.toUpperCase()}`, deadline: now + 3600 };

describe('checkSwapStep', () => {
  it('takes a lock and normalizes hex', () => {
    expect(checkSwapStep(lock, now)).toEqual({ ...lock, hashlock: h });
  });

  it('refuses a deadline in the past or over 7 days ahead', () => {
    expect(() => checkSwapStep({ ...lock, deadline: now }, now)).toThrow(/deadline/);
    expect(() => checkSwapStep({ ...lock, deadline: now + 8 * 86400 }, now)).toThrow(/deadline/);
  });

  it('refuses amounts that are not whole base units', () => {
    for (const amount of ['0', '-1', '1.5', '', '18446744073709551616']) {
      expect(() => checkSwapStep({ ...lock, amount }, now)).toThrow(/amount/);
    }
  });

  it('refuses bad accounts and hex', () => {
    expect(() => checkSwapStep({ ...lock, to: 'bob' }, now)).toThrow(/addresses/);
    expect(() => checkSwapStep({ ...lock, hashlock: 'ab' }, now)).toThrow(/hashlock/);
    expect(() => checkSwapStep({ step: 'reveal', secret: 'zz'.repeat(32), txid: 'ef'.repeat(64), contract: 0 }, now)).toThrow(/secret/);
  });

  it('a reveal names the lock it is for', () => {
    const txid = 'ef'.repeat(64);
    expect(checkSwapStep({ step: 'reveal', secret: h, txid, contract: 2 }, now)).toEqual({ step: 'reveal', secret: h, txid, contract: 2 });
    expect(() => checkSwapStep({ step: 'reveal', secret: h }, now)).toThrow(/txid/);
  });

  it('takes claim and refund by txid and contract', () => {
    const txid = 'ef'.repeat(64);
    expect(checkSwapStep({ step: 'claim', txid, contract: 0 }, now)).toEqual({ step: 'claim', txid, contract: 0 });
    expect(checkSwapStep({ step: 'refund', txid: txid.toUpperCase(), contract: '1' }, now)).toEqual({ step: 'refund', txid, contract: 1 });
    expect(() => checkSwapStep({ step: 'claim', txid: 'ef', contract: 0 }, now)).toThrow(/txid/);
    expect(() => checkSwapStep({ step: 'claim', txid, contract: -1 }, now)).toThrow(/contract/);
  });

  it('refuses unknown steps', () => {
    expect(() => checkSwapStep({ step: 'send' }, now)).toThrow(/step/);
    expect(checkSwapStep({ step: 'setup' }, now)).toEqual({ step: 'setup' });
  });
});
