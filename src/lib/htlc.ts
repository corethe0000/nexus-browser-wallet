//Nexus side of an atomic swap (Nexus DEX): a DEBIT locked to SK256(secret) and an absolute deadline. Shared by the
//wallet (signs swap steps for sites, nexus_swapStep) and the DEX (dex/core re-exports this file).
//
//Reveal slot: every profile that receives on Nexus through the DEX has one local name "nxdex" (created once). Its
//address is a hash of the name and the owner's genesis, which the core enforces, so only the owner can create or write
//it. To claim, the recipient writes the 32 byte secret into the slot's "address" field, then credits the lock.
//
//Two rules this design rests on (LLL-TAO 5.1.6, src/TAO/Operation/condition.cpp):
//- conditions have no short circuit: every part is evaluated, and reading a register that does not exist throws,
//  which fails the refund path too. So the slot must exist BEFORE the sender locks (check with slotState).
//- deadlines use ledger.timestamp (time of the best block). caller/contract timestamps come from the transaction
//  itself and only have to be >= the previous one of its sigchain, so a claimer could backdate past any deadline.
import { creditContract, debitContract, feeContract, memoryOfAddress, memoryOfHex, nameContract, nameFee, namedAddress, nameWriteContract, sk256, type AccountState } from './tritium';

const c = { u64: 0x73, u256: 0x74, eq: 0x80, lt: 0x81, gte: 0x86, and: 0xa0, or: 0xa1, group: 0xa2, ungroup: 0xa3, callerGenesis: 0xc0, regValue: 0xb5, ledgerTs: 0xd2, sk256: 0xe0 };
const addrName = 0xd9;
const slotField = 'address';

export const slotName = 'nxdex';
export const secretBytes = 32;
//one-time slot creation fee on mainnet (a local name), paid from the default NXS account; none on hybrid/private chains
export const slotFee = nameFee;

export interface NexusLockTerms {
  recipient: string; //genesis hex of who may claim with the secret
  sender: string; //genesis hex of who may refund after the deadline
  hashlock: Uint8Array; //sk256(secret), memory order
  deadline: number; //unix seconds, compared with ledger.timestamp
}

export interface SlotState {
  created: number;
  modified: number;
  value: Uint8Array; //memory bytes of the address field
}

export function newSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(secretBytes));
}

export function hashOf(secret: Uint8Array): Uint8Array {
  if (secret.length !== secretBytes) {
    throw new Error('secret must be 32 bytes');
  }
  return sk256(secret);
}

export function secretMatches(secret: Uint8Array, hashlock: Uint8Array): boolean {
  const h = hashOf(secret);
  return h.length === hashlock.length && h.every((b, i) => b === hashlock[i]);
}

//memory bytes of a profile's reveal slot
export function slotAddress(genesis: string): Uint8Array {
  return namedAddress(slotName, memoryOfHex(genesis), addrName);
}

//the slot as register/get/any prints it: a name object shows its address field as "register" ("0" when zero, else
//base58) while "address" is the name's own address
export function parseSlot(r: { created: number; modified: number; register?: unknown }): SlotState {
  const v = String(r.register ?? '0');
  const value = v === '0' ? new Uint8Array(32) : /^[0-9a-f]{64}$/.test(v) ? memoryOfHex(v) : memoryOfAddress(v);
  return { created: r.created, modified: r.modified, value };
}

//(recipient AND SK256(slot.address) == H AND ledger.timestamp < D) OR (sender AND ledger.timestamp >= D)
export function lockCondition(t: NexusLockTerms): Uint8Array {
  const field = new TextEncoder().encode(slotField);
  const out: number[] = [];
  const u8 = (v: number) => out.push(v);
  const raw = (b: Uint8Array) => out.push(...b);
  const u64 = (v: bigint) => {
    for (let i = 0; i < 8; i++) {
      out.push(Number((v >> BigInt(8 * i)) & 0xffn));
    }
  };
  const genesisIs = (g: string) => {
    u8(c.callerGenesis);
    u8(c.eq);
    u8(c.u256);
    raw(memoryOfHex(g));
  };
  const deadline = (cmp: number) => {
    u8(c.ledgerTs);
    u8(cmp);
    u8(c.u64);
    u64(BigInt(t.deadline));
  };
  u8(c.group);
  genesisIs(t.recipient);
  u8(c.and);
  u8(c.u256);
  raw(slotAddress(t.recipient));
  u8(c.regValue);
  u8(field.length);
  raw(field);
  u8(c.sk256);
  u8(c.eq);
  u8(c.u256);
  raw(t.hashlock);
  u8(c.and);
  deadline(c.lt);
  u8(c.ungroup);
  u8(c.or);
  u8(c.group);
  genesisIs(t.sender);
  u8(c.and);
  deadline(c.gte);
  u8(c.ungroup);
  return Uint8Array.from(out);
}

//the lock: DEBIT from the sender's account to the recipient's account with the condition
export function lockContract(from: { address: string; state: AccountState }, to: string, amount: bigint, t: NexusLockTerms, timestamp: number): Uint8Array {
  return debitContract({ from, to, amount, condition: lockCondition(t) }, timestamp);
}

//one time: the recipient's reveal slot (+ the name fee on mainnet)
export function slotCreateContracts(genesis: string, timestamp: number, fee?: { account: string; state: AccountState; amount: bigint }): Uint8Array[] {
  const list = [nameContract(genesis, slotName, new Uint8Array(32), false, timestamp)];
  if (fee && fee.amount > 0n) {
    list.push(feeContract(memoryOfAddress(fee.account), fee.state, fee.amount, timestamp));
  }
  return list;
}

//the reveal: write the secret into the slot
export function revealContract(genesis: string, slot: SlotState, secret: Uint8Array, timestamp: number): Uint8Array {
  if (secret.length !== secretBytes) {
    throw new Error('secret must be 32 bytes');
  }
  return nameWriteContract(genesis, slotName, { created: slot.created, modified: slot.modified, address: slot.value }, secret, timestamp);
}

//the claim, once the slot holds the secret: CREDIT of the lock into the recipient's account
export function claimContract(lockTxid: string, contract: number, to: { address: string; state: AccountState }, fromAccount: string, amount: bigint, timestamp: number): Uint8Array {
  return creditContract({ debitTxid: lockTxid, contract, to, from: fromAccount, amount }, timestamp);
}

//the refund after the deadline: CREDIT back into the account the lock came from (core AddVoid form)
export function refundContract(lockTxid: string, contract: number, from: { address: string; state: AccountState }, amount: bigint, timestamp: number): Uint8Array {
  return creditContract({ debitTxid: lockTxid, contract, to: from, from: from.address, amount }, timestamp);
}
