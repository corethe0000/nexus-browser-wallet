import { describe, expect, it } from 'vitest';
import { expiresAt, expirySeconds, isClaimable, isExpired } from './claims';
import type { Notification } from './types';

const sender = 'b79ead583e88e06d31f1c4dedeb6ac91c77d1cbbb505eb320a745f7c97b8bf75';
const cond = (s: number) => `(caller.genesis != 0x${sender} AND contract.timestamp + ${s} > caller.timestamp) OR (caller.genesis == 0x${sender} AND contract.timestamp + ${s} < caller.timestamp)`;

describe('send expiry', () => {
  it('reads the expiry from the core condition', () => {
    expect(expirySeconds({ conditions: cond(604800) })).toBe(604800);
    expect(expirySeconds({ conditions: 'caller.genesis != contract.genesis' })).toBeNull();
    expect(expirySeconds({})).toBeNull();
    //only the core's template counts, a sender's own condition with a time in it is no expiry
    expect(expirySeconds({ conditions: 'contract.timestamp + 1 > caller.timestamp' })).toBeNull();
    expect(expirySeconds({ conditions: cond(600) + ' OR contract.timestamp + 1 < caller.timestamp' })).toBeNull();
    expect(expiresAt({ conditions: cond(600) }, 1000)).toBe(1600);
  });

  it('expired payments are no longer claimable', () => {
    const at = 1_000_000;
    const n = { OP: 'DEBIT', id: 0, txid: 'x', timestamp: at, conditions: cond(600) } as Notification;
    expect(isExpired(n, at, (at + 599) * 1000)).toBe(false);
    expect(isClaimable(n, (at + 599) * 1000)).toBe(true);
    expect(isClaimable(n, (at + 601) * 1000)).toBe(false);
    //market settlements carry no expiry
    expect(isClaimable({ ...n, conditions: 'caller.genesis != contract.genesis' }, (at + 10 ** 7) * 1000)).toBe(true);
  });
});
