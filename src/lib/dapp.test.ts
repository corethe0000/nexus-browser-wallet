import { describe, expect, it } from 'vitest';
import { checkSendParams, DappErrors, originLabel } from './dapp';
import { isRecipient, isReference } from './format';

const check = (p: unknown) => checkSendParams(p, isRecipient, isReference);

describe('checkSendParams', () => {
  it('accepts a plain NXS send', () => {
    expect(check({ to: 'bob:main', amount: 1.5 })).toEqual({ to: 'bob:main', amount: 1.5, token: '0', reference: undefined });
  });

  it('reads amount as text, NXS ticker and reference', () => {
    expect(check({ to: ' bob:main ', amount: '2', token: 'nxs', reference: 42 })).toEqual({ to: 'bob:main', amount: 2, token: '0', reference: '42' });
  });

  it('keeps a token ticker or address', () => {
    expect(check({ to: 'bob:testt', amount: 1, token: 'TESTT' }).token).toBe('TESTT');
  });

  it('refuses bad input with invalid params', () => {
    for (const p of [null, {}, { to: 'a b', amount: 1 }, { to: 'bob', amount: 0 }, { to: 'bob', amount: 'x' }, { to: 'bob', amount: -1 }, { to: 'bob', amount: 1, reference: '1.5' }, { to: 'bob', amount: 1, token: 5 }]) {
      let code = 0;
      try {
        check(p);
      } catch (e) {
        code = (e as { code: number }).code;
      }
      expect(code, JSON.stringify(p)).toBe(DappErrors.InvalidParams);
    }
  });
});

describe('originLabel', () => {
  it('shows host only', () => {
    expect(originLabel('https://shop.example:8443')).toBe('shop.example:8443');
  });
});

describe('market params', () => {
  it('checks market, txid and order values', async () => {
    const { checkMarket, checkTxid, checkPlaceParams } = await import('./dapp');
    expect(checkMarket(' TESTT/NXS ')).toBe('TESTT/NXS');
    expect(() => checkMarket('TESTT')).toThrow();
    expect(() => checkMarket('A/B/C')).toThrow();
    expect(() => checkMarket('A B/C')).toThrow();
    expect(checkTxid('AB'.repeat(64))).toBe('ab'.repeat(64));
    expect(() => checkTxid('abc')).toThrow();
    expect(checkPlaceParams({ side: 'sell', amount: '5', price: 2 })).toEqual({ side: 'sell', amount: 5, price: 2 });
    expect(() => checkPlaceParams({ side: 'hold', amount: 5, price: 2 })).toThrow();
    expect(() => checkPlaceParams({ side: 'buy', amount: 0, price: 2 })).toThrow();
  });
});
