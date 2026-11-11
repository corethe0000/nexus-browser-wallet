import type { Notification } from './types';

//incoming items the user takes with a credit or claim: payments, and assets sent with a transfer
//(invoices also come as transfers but are paid, not claimed)
export function isClaimable(n: Notification, now = Date.now()): boolean {
  return (n.OP === 'DEBIT' || isAssetTransfer(n)) && !isExpired(n, n.timestamp, now);
}

//"contract.timestamp + 604800": the receiver may claim before that time, the sender take it back after it
//what the wallet asks for a send unless the user picks another time (the core default too)
export const defaultExpiry = 604800;

//finance/debit with expires: receiver before the time, sender (void) after it, same seconds in both halves
const expiryTemplate = /^\(caller\.genesis != 0x([0-9a-f]{64}) AND contract\.timestamp \+ (\d+) > caller\.timestamp\) OR \(caller\.genesis == 0x\1 AND contract\.timestamp \+ \2 < caller\.timestamp\)$/i;

export function expirySeconds(c: { conditions?: string }): number | null {
  const m = c.conditions?.trim().match(expiryTemplate);
  return m ? Number(m[2]) : null;
}

export function expiresAt(c: { conditions?: string }, timestamp: number): number | null {
  const s = expirySeconds(c);
  return s === null ? null : timestamp + s;
}

export function isExpired(c: { conditions?: string }, timestamp: number, now = Date.now()): boolean {
  const at = expiresAt(c, timestamp);
  return at !== null && now / 1000 > at;
}

export function isAssetTransfer(n: Notification): boolean {
  return n.OP === 'TRANSFER' && n.form === 'ASSET';
}
