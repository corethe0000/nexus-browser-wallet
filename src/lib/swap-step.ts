//nexus_swapStep: a site (the Nexus DEX) asks the wallet to sign one Nexus step of an atomic swap. The wallet checks
//the step, shows it in plain words and signs after the PIN; the site never sees the password or the PIN.
//Only in the mode that signs in this browser: the core API has no hashlocked payment.
import { isAddress } from './format';
import { DappError, DappErrors } from './dapp';

//JSON safe (amounts in base units as strings), it travels between site, background and approval window
export type SwapStep =
  | { step: 'setup' }
  //lock: a payment from an own account that the recipient can take with the secret before the deadline,
  //and the sender can take back from the deadline on
  | { step: 'lock'; from: string; to: string; amount: string; recipient: string; hashlock: string; deadline: number }
  //reveal: write the secret into the own reveal slot, so a lock to us can be taken
  | { step: 'reveal'; secret: string }
  //claim: take a lock made to an own account; refund: take back an own lock after its deadline
  | { step: 'claim'; txid: string; contract: number }
  | { step: 'refund'; txid: string; contract: number };

//what the approval window shows, worked out by the wallet from the chain (never the site's words)
export interface SwapShown {
  amount?: string; //formatted with the token's decimals
  ticker?: string;
  account?: string; //own account the step takes from or pays into
  counter?: string; //the other side's account (lock)
  deadline?: number;
  fee?: string; //NXS, setup on mainnet
}

const hex64 = /^[0-9a-f]{64}$/;
const txid128 = /^[0-9a-f]{128}$/;
//a lock deadline further out than this is refused: a mistake or a site that wants the funds stuck
const maxLockSeconds = 7 * 24 * 3600;

function bad(message: string): never {
  throw new DappError(DappErrors.InvalidParams, message);
}

function hexParam(v: unknown, what: string): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/^0x/, '') : '';
  if (!hex64.test(s)) {
    bad(`${what} must be 32 bytes hex`);
  }
  return s;
}

function contractParam(p: Record<string, unknown>): { txid: string; contract: number } {
  const txid = typeof p.txid === 'string' ? p.txid.trim().toLowerCase() : '';
  if (!txid128.test(txid)) {
    bad('txid must be the 128 hex characters of the lock transaction');
  }
  const contract = Number(p.contract);
  if (!Number.isInteger(contract) || contract < 0 || contract > 99) {
    bad('contract must be the index of the lock in its transaction');
  }
  return { txid, contract };
}

export function checkSwapStep(raw: unknown, now = Math.floor(Date.now() / 1000)): SwapStep {
  const p = (raw ?? {}) as Record<string, unknown>;
  switch (p.step) {
    case 'setup':
      return { step: 'setup' };
    case 'lock': {
      const from = typeof p.from === 'string' ? p.from.trim() : '';
      const to = typeof p.to === 'string' ? p.to.trim() : '';
      if (!isAddress(from) || !isAddress(to)) {
        bad('from and to must be account addresses');
      }
      const amount = typeof p.amount === 'string' || typeof p.amount === 'number' ? String(p.amount).trim() : '';
      if (!/^[1-9][0-9]{0,19}$/.test(amount) || BigInt(amount) >= 1n << 64n) {
        bad('amount must be a positive whole number of base units');
      }
      const deadline = Number(p.deadline);
      if (!Number.isInteger(deadline) || deadline <= now || deadline > now + maxLockSeconds) {
        bad('deadline must be a unix time within the next 7 days');
      }
      return { step: 'lock', from, to, amount, recipient: hexParam(p.recipient, 'recipient'), hashlock: hexParam(p.hashlock, 'hashlock'), deadline };
    }
    case 'reveal':
      return { step: 'reveal', secret: hexParam(p.secret, 'secret') };
    case 'claim':
    case 'refund':
      return { step: p.step, ...contractParam(p) };
    default:
      return bad('step must be setup, lock, reveal, claim or refund');
  }
}
