//Tritium transactions built and signed in the browser, the way the core builds them (src/TAO/Ledger/create.cpp,
//transaction.cpp, src/TAO/Register/build.cpp), to submit with ledger/submit/transaction to any node, no login there
import { Keccak, sha3_256, sha3_512 } from '@noble/hashes/sha3.js';
import { argon2id } from 'hash-wasm';
import { fromHex, privateKeyOf, publicKeyOf, signer, toHex } from './keys';
import { skein } from './skein';

const enc = new TextEncoder();

//core numbers (TAO/Operation/include/enum.h, TAO/Register/include/enum.h, TAO/Ledger/include/enum.h, LLP/include/inv.h)
const opWrite = 0x01;
const opCreate = 0x02;
const opTransfer = 0x04;
const opValidate = 0x40;
const opCondition = 0x41;
const opClaim = 0x05;
const opDebit = 0x10;
const opFee = 0x17;
const opCredit = 0x11;
const statePre = 0x01;
const statePost = 0x02;
const typeMutable = 0xff;
const typeUint8 = 0x01;
const typeUint16 = 0x02;
const typeUint64 = 0x04;
const typeUint256 = 0x05;
const typeString = 0x08;
//register address types (TAO/Register/types/address.h)
const addrCrypto = 0xd5;
const addrAccount = 0xd6;
const addrTrust = 0xd8;
const addrName = 0xd9;
const registerObject = 0x04;
const stateVersion = 1;
const txTypeTritium = 0x01;
const msgTxTritium = 3;
export const keyBrainpool = 0x02;
const argonPasses = 12;
const argonMemoryKiB = 1 << 16;
const recoveryPasses = 64;
//strict DER of the core (ECKey::Encoding): r and s exactly 64 bytes each, 135 bytes in all
const sigPartBytes = 64;
const maxSignTries = 64;
//MAX_TRANSACTION_CONTRACTS
const maxContracts = 100;
//condition script (TAO/Operation/include/enum.h)
const cond = { uint64: 0x73, uint256: 0x74, equals: 0x80, lessThan: 0x81, greaterThan: 0x82, notEquals: 0x83, add: 0x90, and: 0xa0, or: 0xa1, group: 0xa2, ungroup: 0xa3, callerGenesis: 0xc0, callerTimestamp: 0xc1, contractTimestamp: 0xcb };

//--- hashes ---

//SK512: SHA3-512 of Skein-512-512, as memory bytes
export function sk512(data: Uint8Array): Uint8Array {
  return sha3_512(skein(data, 512, 512));
}

export function sk256(data: Uint8Array): Uint8Array {
  return sha3_256(skein(data, 256, 256));
}

//SK64: Keccak rate 1344, 64 bit output, SHA3 padding over Skein-256-64 (register checksums)
export function sk64(data: Uint8Array): bigint {
  const k = new Keccak(1344 / 8, 0x06, 8);
  k.update(skein(data, 256, 64));
  const out = k.digest();
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(out[i]!);
  }
  return v;
}

//--- byte forms ---

//the node prints a base_uint as hex of its memory bytes reversed
export function memoryOfHex(hex: string): Uint8Array {
  return fromHex(hex).reverse();
}

export function hexOfMemory(mem: Uint8Array): string {
  return toHex(Uint8Array.from(mem).reverse());
}

//GetBytes/SetBytes write each 32-bit word big endian
function swapWords(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
    out[i] = bytes[i + 3]!;
    out[i + 1] = bytes[i + 2]!;
    out[i + 2] = bytes[i + 1]!;
    out[i + 3] = bytes[i]!;
  }
  return out;
}

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

//register address (base58: type byte, 32 bytes, 4 byte SK256 checksum) to the uint256 in memory
export function memoryOfAddress(address: string): Uint8Array {
  let v = 0n;
  for (const c of address) {
    const i = base58Alphabet.indexOf(c);
    if (i < 0) {
      throw new Error('bad address');
    }
    v = v * 58n + BigInt(i);
  }
  const bytes = new Uint8Array(37);
  for (let i = 36; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  const payload = bytes.subarray(0, 33);
  const check = sk256(payload).subarray(0, 4);
  if (!check.every((b, i) => b === bytes[33 + i])) {
    throw new Error('bad address checksum');
  }
  return swapWords(payload.subarray(1));
}

class Writer {
  private parts: number[] = [];

  u8(n: number) {
    this.parts.push(n & 0xff);
    return this;
  }

  u32(n: number) {
    for (let i = 0; i < 4; i++) {
      this.parts.push((n >>> (8 * i)) & 0xff);
    }
    return this;
  }

  u64(n: bigint) {
    for (let i = 0n; i < 8n; i++) {
      this.parts.push(Number((n >> (8n * i)) & 0xffn));
    }
    return this;
  }

  raw(b: Uint8Array) {
    for (const x of b) {
      this.parts.push(x);
    }
    return this;
  }

  //CompactSize then the bytes (std::vector, std::string)
  vec(b: Uint8Array) {
    const n = b.length;
    if (n < 253) {
      this.u8(n);
    } else if (n <= 0xffff) {
      this.u8(253).u8(n).u8(n >> 8);
    } else {
      this.u8(254).u32(n);
    }
    return this.raw(b);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

//--- registers ---

export interface AccountState {
  owner: string; //genesis hex as the node prints it
  created: number;
  modified: number;
  balance: bigint; //in the token's smallest units
  token: string; //'0' for NXS or the token's register address
  //set on a token's own register, which holds the undistributed supply
  tokenInfo?: { supply: bigint; decimals: number };
}

//TAO::Register::CreateAccount: balance (mutable uint64) and token (uint256)
function accountData(balance: bigint, tokenMem: Uint8Array): Uint8Array {
  return new Writer()
    .vec(enc.encode('balance'))
    .u8(typeMutable)
    .u8(typeUint64)
    .u64(balance)
    .vec(enc.encode('token'))
    .u8(typeUint256)
    .raw(tokenMem)
    .bytes();
}

//TAO::Register::CreateToken: balance (mutable), token, supply, decimals
function tokenData(balance: bigint, tokenMem: Uint8Array, supply: bigint, decimals: number): Uint8Array {
  return new Writer()
    .vec(enc.encode('balance'))
    .u8(typeMutable)
    .u8(typeUint64)
    .u64(balance)
    .vec(enc.encode('token'))
    .u8(typeUint256)
    .raw(tokenMem)
    .vec(enc.encode('supply'))
    .u8(typeUint64)
    .u64(supply)
    .vec(enc.encode('decimals'))
    .u8(typeUint8)
    .u8(decimals)
    .bytes();
}

function tokenMemory(token: string): Uint8Array {
  return token === '0' ? new Uint8Array(32) : memoryOfAddress(token);
}

//State serialization; the checksum is SK64 of everything before it
function serializeState(a: AccountState, withChecksum: boolean): { bytes: Uint8Array; checksum: bigint } {
  const body = new Writer()
    .u8(stateVersion)
    .u8(registerObject)
    .raw(memoryOfHex(a.owner))
    .u64(BigInt(a.created))
    .u64(BigInt(a.modified))
    .vec(a.tokenInfo ? tokenData(a.balance, memoryOfAddress(a.token), a.tokenInfo.supply, a.tokenInfo.decimals) : accountData(a.balance, tokenMemory(a.token)))
    .bytes();
  const checksum = sk64(body);
  return { bytes: withChecksum ? new Writer().raw(body).u64(checksum).bytes() : body, checksum };
}

//--- transaction ---

export interface PrevTx {
  txid: string;
  sequence: number;
  timestamp: number;
  genesis: string;
  //0 when the profile has no recovery phrase
  recovery?: string;
}

export interface DebitParams {
  from: { address: string; state: AccountState };
  to: string; //register address of the receiving account
  amount: bigint;
  reference?: bigint;
  //from expiryCondition, none on a send to an own account
  condition?: Uint8Array;
}

//claim of one DEBIT contract into an own account
export interface CreditParams {
  debitTxid: string;
  contract: number;
  to: { address: string; state: AccountState };
  //the account the debit came from (proof)
  from: string;
  amount: bigint;
}

function contract(op: Uint8Array, condition: Uint8Array, register: Uint8Array): Uint8Array {
  return new Writer().vec(op).vec(condition).vec(register).bytes();
}

//pre-state of an account and the checksum of its state after the change
function accountRegister(state: AccountState, balance: bigint, timestamp: number): Uint8Array {
  const pre = serializeState(state, true).bytes;
  const post = serializeState({ ...state, balance, modified: timestamp }, false).checksum;
  return new Writer().u8(statePre).raw(pre).u8(statePost).u64(post).bytes();
}

//OP::CREDIT: debit txid, contract number, own account, source account, amount (API/build.cpp BuildCredits)
export function creditContract(p: CreditParams, timestamp: number): Uint8Array {
  const op = new Writer().u8(opCredit).raw(memoryOfHex(p.debitTxid)).u32(p.contract).raw(memoryOfAddress(p.to.address)).raw(memoryOfAddress(p.from)).u64(p.amount).bytes();
  return contract(op, new Uint8Array(0), accountRegister(p.to.state, p.to.state.balance + p.amount, timestamp));
}

//OP::DEBIT with the pre-state of the account and the checksum of its state after the debit
export function debitContract(p: DebitParams, timestamp: number): Uint8Array {
  const op = new Writer().u8(opDebit).raw(memoryOfAddress(p.from.address)).raw(memoryOfAddress(p.to)).u64(p.amount).u64(p.reference ?? 0n).bytes();
  if (p.amount > p.from.state.balance) {
    throw new Error('amount is more than the balance');
  }
  return contract(op, p.condition ?? new Uint8Array(0), accountRegister(p.from.state, p.from.state.balance - p.amount, timestamp));
}

//API/conditions.cpp AddExpires: the receiver claims before the time, the sender takes back after it;
//0 = never expires, only the receiver can claim
export function expiryCondition(genesis: string, seconds: number): Uint8Array {
  const me = memoryOfHex(genesis);
  const w = new Writer();
  const caller = (compare: number) => w.u8(cond.callerGenesis).u8(compare).u8(cond.uint256).raw(me);
  if (seconds === 0) {
    w.u8(cond.group);
    caller(cond.notEquals);
    return w.u8(cond.ungroup).bytes();
  }
  const half = (who: number, time: number) => {
    w.u8(cond.group);
    caller(who);
    w.u8(cond.and).u8(cond.contractTimestamp).u8(cond.add).u8(cond.uint64).u64(BigInt(seconds)).u8(time).u8(cond.callerTimestamp).u8(cond.ungroup);
  };
  half(cond.notEquals, cond.greaterThan);
  w.u8(cond.or);
  half(cond.equals, cond.lessThan);
  return w.bytes();
}

interface Header {
  version: number;
  sequence: number;
  timestamp: number;
  next: Uint8Array;
  recovery: Uint8Array;
  genesis: Uint8Array;
  prev: Uint8Array;
  keyType: number;
  nextType: number;
}

function serializeTx(contracts: Uint8Array[], h: Header, pubKey?: Uint8Array, sig?: Uint8Array): Uint8Array {
  const w = new Writer();
  w.u8(contracts.length);
  contracts.forEach((c) => w.raw(c));
  w.u32(h.version).u32(h.sequence).u64(BigInt(h.timestamp)).raw(h.next).raw(h.recovery).raw(h.genesis).raw(h.prev).u8(h.keyType).u8(h.nextType);
  if (pubKey && sig) {
    w.vec(pubKey).vec(sig);
  }
  return w.bytes();
}

//Credentials::Generate(nKeyID, pin): the key of one sigchain transaction
export async function sequenceKey(username: string, password: string, pin: string, sequence: number) {
  const id = new Writer().u32(sequence).bytes();
  let salt = Uint8Array.from([...enc.encode(username), ...id]);
  if (salt.length < 8) {
    salt = Uint8Array.from([...salt, ...new Uint8Array(8 - salt.length)]);
  }
  const secret = await argon2id({
    password: Uint8Array.from([...enc.encode(password), ...id]),
    salt,
    secret: Uint8Array.from([...enc.encode(pin), ...id]),
    iterations: argonPasses,
    memorySize: argonMemoryKiB,
    parallelism: 1,
    hashLength: 64,
    outputType: 'binary',
  });
  const privateKey = privateKeyOf(secret);
  secret.fill(0);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

//Credentials::Generate(strSecret): the recovery key. Argon2id of the phrase, 64 passes, 64 MB, 16 zero bytes of salt,
//32 bytes kept as a uint256 with the network's user type on top, then widened to the 64 byte secret
export async function recoveryKey(phrase: string, userType: number) {
  const out = await argon2id({ password: enc.encode(phrase), salt: new Uint8Array(16), iterations: recoveryPasses, memorySize: argonMemoryKiB, parallelism: 1, hashLength: 32, outputType: 'binary' });
  const mem = swapWords(out);
  mem[31] = userType;
  const secret = new Uint8Array(64);
  secret.set(swapWords(mem));
  const privateKey = privateKeyOf(secret);
  secret.fill(0);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

//Transaction::NextHash: SK256 of the next key's public key, as the node prints it
export function nextHashOf(publicKey: Uint8Array): string {
  return hexOfMemory(sk256(publicKey));
}

//compact signature = r and s, 64 bytes each, big endian
function strictDer(compact: Uint8Array): Uint8Array | null {
  const r = compact.subarray(0, sigPartBytes);
  const s = compact.subarray(sigPartBytes, 2 * sigPartBytes);
  //DER needs a 0x00 pad when the top bit is set, the core takes only 64 byte values
  if (r[0]! === 0 || r[0]! >= 0x80 || s[0]! === 0 || s[0]! >= 0x80) {
    return null;
  }
  return Uint8Array.from([0x30, 0x81, 0x84, 0x02, sigPartBytes, ...r, 0x02, sigPartBytes, ...s]);
}

export interface SignedTx {
  txid: string;
  //what ledger/submit/transaction takes as data
  data: string;
}

//signs and serializes contracts as the next transaction of a chain; keys = this sequence's key and the next one's
export function signTx(
  prev: PrevTx,
  contracts: (timestamp: number) => Uint8Array[],
  timestamp: number,
  key: { privateKey: Uint8Array; publicKey: Uint8Array },
  nextKey: { publicKey: Uint8Array },
  version = 4,
): SignedTx {
  const p = { prev, timestamp };
  if (p.timestamp < p.prev.timestamp) {
    throw new Error('timestamp before the previous transaction');
  }
  const h: Header = {
    version,
    sequence: p.prev.sequence + 1,
    timestamp: p.timestamp,
    next: sk256(nextKey.publicKey),
    recovery: p.prev.recovery ? memoryOfHex(p.prev.recovery) : new Uint8Array(32),
    genesis: memoryOfHex(p.prev.genesis),
    prev: memoryOfHex(p.prev.txid),
    keyType: keyBrainpool,
    nextType: keyBrainpool,
  };
  return signHeader(h, contracts(timestamp), key);
}

//txid, signature and serialization of a finished header and its contracts
function signHeader(h: Header, list: Uint8Array[], key: { privateKey: Uint8Array; publicKey: Uint8Array }): SignedTx {
  if (!list.length || list.length > maxContracts) {
    throw new Error('a transaction needs 1 to 100 contracts');
  }
  const hash = sk512(serializeTx(list, h));
  hash[63] = txTypeTritium;
  //ECKey::Sign(GetHash().GetBytes()): ECDSA over those 64 bytes as they are, no further hashing
  const msg = swapWords(hash);
  let sig: Uint8Array | null = null;
  for (let i = 0; i < maxSignTries && !sig; i++) {
    sig = strictDer(signer.sign(msg, key.privateKey, { prehash: false, extraEntropy: true, format: 'compact' }));
  }
  if (!sig) {
    throw new Error('could not make a signature the core takes');
  }
  const tx = serializeTx(list, h, key.publicKey, sig);
  return { txid: hexOfMemory(hash), data: toHex(Uint8Array.from([msgTxTritium, ...tx])) };
}

//--- reading transactions back (ledger/get/transaction format raw) ---

class Reader {
  pos = 0;

  constructor(private b: Uint8Array) {}

  u8(): number {
    if (this.pos >= this.b.length) {
      throw new Error('raw transaction ends early');
    }
    return this.b[this.pos++]!;
  }

  u32(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      v |= this.u8() << (8 * i);
    }
    return v >>> 0;
  }

  u64(): bigint {
    let v = 0n;
    for (let i = 0n; i < 8n; i++) {
      v |= BigInt(this.u8()) << (8n * i);
    }
    return v;
  }

  take(n: number): Uint8Array {
    if (this.pos + n > this.b.length) {
      throw new Error('raw transaction ends early');
    }
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  compact(): number {
    const n = this.u8();
    if (n < 253) {
      return n;
    }
    if (n === 253) {
      return this.u8() | (this.u8() << 8);
    }
    if (n === 254) {
      return this.u32();
    }
    throw new Error('size too big');
  }

  vec(): Uint8Array {
    return this.take(this.compact());
  }
}

export interface TxHeader {
  version: number;
  sequence: number;
  timestamp: number;
  nexthash: string;
  recovery: string;
  genesis: string;
  prevTx: string;
  keyType: number;
  nextType: number;
  contracts: number;
  //each contract serialized as in the transaction
  contractBytes: Uint8Array[];
}

//header of a serialized Tritium transaction (with or without the message type byte in front)
export function parseTx(hex: string): TxHeader {
  let bytes = fromHex(hex);
  if (bytes[0] === msgTxTritium) {
    bytes = bytes.subarray(1);
  }
  const r = new Reader(bytes);
  const count = r.compact();
  const contractBytes: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const start = r.pos;
    r.vec();
    r.vec();
    r.vec();
    contractBytes.push(bytes.slice(start, r.pos));
  }
  return {
    contracts: count,
    contractBytes,
    version: r.u32(),
    sequence: r.u32(),
    timestamp: Number(r.u64()),
    nexthash: hexOfMemory(r.take(32)),
    recovery: hexOfMemory(r.take(32)),
    genesis: hexOfMemory(r.take(32)),
    prevTx: hexOfMemory(r.take(64)),
    keyType: r.u8(),
    nextType: r.u8(),
  };
}

//--- a new profile: the first transaction of a signature chain (API/commands/profiles/create.cpp) ---

//object register fields
const field = {
  string: (w: Writer, name: string, value: string) => w.vec(enc.encode(name)).u8(typeString).vec(enc.encode(value)),
  u64: (w: Writer, name: string, value: bigint) => w.vec(enc.encode(name)).u8(typeMutable).u8(typeUint64).u64(value),
  u256: (w: Writer, name: string, value: Uint8Array, mutable = true) => {
    w.vec(enc.encode(name));
    if (mutable) {
      w.u8(typeMutable);
    }
    return w.u8(typeUint256).raw(value);
  },
};

//Address(key, namespace, type): SK256 of the key and the namespace hash, type in the top byte
export function namedAddress(key: string, namespaceMem: Uint8Array, type: number): Uint8Array {
  const mem = sk256(Uint8Array.from([...enc.encode(key), ...namespaceMem]));
  mem[31] = type;
  return mem;
}

//base58 form of a register address in memory (type byte, word swapped bytes, SK256 checksum)
export function addressOfMemory(mem: Uint8Array): string {
  const payload = Uint8Array.from([mem[31]!, ...swapWords(mem)]);
  const bytes = Uint8Array.from([...payload, ...sk256(payload).subarray(0, 4)]);
  let v = 0n;
  for (const b of bytes) {
    v = (v << 8n) | BigInt(b);
  }
  let out = '';
  while (v > 0n) {
    out = base58Alphabet[Number(v % 58n)] + out;
    v /= 58n;
  }
  return out;
}

//OP::CREATE of an object register owned by the genesis, post-state checksum of the new state
function createContract(address: Uint8Array, data: Uint8Array, genesisMem: Uint8Array, timestamp: number, type = registerObject): Uint8Array {
  const op = new Writer().u8(opCreate).raw(address).u8(type).vec(data).bytes();
  const state = new Writer().u8(stateVersion).u8(type).raw(genesisMem).u64(BigInt(timestamp)).u64(BigInt(timestamp)).vec(data).bytes();
  return contract(op, new Uint8Array(0), new Writer().u8(statePost).u64(sk64(state)).bytes());
}

function nameData(namespace: string, name: string, register: Uint8Array): Uint8Array {
  const w = new Writer();
  field.string(w, 'namespace', namespace);
  field.string(w, 'name', name);
  field.u256(w, 'address', register);
  return w.bytes();
}

function trustData(): Uint8Array {
  const w = new Writer();
  field.u64(w, 'balance', 0n);
  field.u64(w, 'trust', 0n);
  field.u64(w, 'stake', 0n);
  field.u256(w, 'token', new Uint8Array(32), false);
  return w.bytes();
}

function accountDataNew(): Uint8Array {
  const w = new Writer();
  field.u64(w, 'balance', 0n);
  field.u256(w, 'token', new Uint8Array(32), false);
  return w.bytes();
}

//TAO::Register::CreateCrypto, fields in this order; a field not given is zero
const cryptoFields = ['auth', 'lisp', 'network', 'sign', 'verify', 'cert', 'app1', 'app2', 'app3'] as const;
export type CryptoFields = Partial<Record<(typeof cryptoFields)[number], string>>;

function cryptoData(keys: CryptoFields): Uint8Array {
  const w = new Writer();
  for (const name of cryptoFields) {
    field.u256(w, name, keys[name] ? memoryOfHex(keys[name]!) : new Uint8Array(32));
  }
  return w.bytes();
}

//API/build.cpp BuildCrypto: OP::WRITE of new key hashes into the crypto register, with its pre-state and the
//checksum after the write
export function credentialsContract(genesis: string, register: { created: number; modified: number; fields: CryptoFields }, updates: CryptoFields, timestamp: number): Uint8Array {
  const owner = memoryOfHex(genesis);
  const address = namedAddress('crypto', owner, addrCrypto);
  const stream = new Writer();
  for (const name of cryptoFields) {
    if (updates[name]) {
      stream.vec(enc.encode(name)).u8(cond.uint256).raw(memoryOfHex(updates[name]!));
    }
  }
  const state = (modified: number, fields: CryptoFields) =>
    new Writer().u8(stateVersion).u8(registerObject).raw(owner).u64(BigInt(register.created)).u64(BigInt(modified)).vec(cryptoData(fields)).bytes();
  const before = state(register.modified, register.fields);
  const after = state(timestamp, { ...register.fields, ...updates });
  const reg = new Writer().u8(statePre).raw(before).u64(sk64(before)).u8(statePost).u64(sk64(after)).bytes();
  return contract(new Writer().u8(opWrite).raw(address).vec(stream.bytes()).bytes(), new Uint8Array(0), reg);
}

//FIRST_REQUIRED_WORK = ~0 >> 16: the proof hash needs its top 16 bits zero
const proofZeroBytes = 2;

//Transaction::ProofHash: Argon2id of the hashed form, salt = genesis, 1 pass, 256 KB
async function proofHash(txBytes: Uint8Array, genesisMem: Uint8Array): Promise<Uint8Array> {
  return argon2id({ password: txBytes, salt: genesisMem, iterations: 1, memorySize: 256, parallelism: 1, hashLength: 64, outputType: 'binary' });
}

function increment(mem: Uint8Array) {
  for (let i = 0; i < mem.length; i++) {
    mem[i] = (mem[i]! + 1) & 0xff;
    if (mem[i] !== 0) {
      break;
    }
  }
}

//contracts of the first transaction: on a mother network the trust and default accounts with their names, then the
//crypto register (hybrid and private networks only the crypto register)
export function genesisContracts(genesis: string, ts: number, keyHashes: CryptoKeyHashes, hybrid: boolean, account: Uint8Array): { list: Uint8Array[]; trust?: Uint8Array } {
  const genesisMem = memoryOfHex(genesis);
  const list: Uint8Array[] = [];
  let trust: Uint8Array | undefined;
  if (!hybrid) {
    trust = namedAddress('trust', genesisMem, addrTrust);
    list.push(createContract(namedAddress('trust', genesisMem, addrName), nameData('', 'trust', trust), genesisMem, ts));
    list.push(createContract(trust, trustData(), genesisMem, ts));
    list.push(createContract(namedAddress('default', genesisMem, addrName), nameData('', 'default', account), genesisMem, ts));
    list.push(createContract(account, accountDataNew(), genesisMem, ts));
  }
  list.push(createContract(namedAddress('crypto', genesisMem, addrCrypto), cryptoData(keyHashes), genesisMem, ts));
  return { list, trust };
}

export async function meetsFirstWork(hashedForm: Uint8Array, genesisMem: Uint8Array): Promise<boolean> {
  const proof = await proofHash(hashedForm, genesisMem);
  return proof.subarray(64 - proofZeroBytes).every((b) => b === 0);
}

//hashed form (no public key, no signature) of contracts and a parsed header, to check a txid
export function hashedForm(contracts: Uint8Array[], h: TxHeader): Uint8Array {
  return serializeTx(contracts, { version: h.version, sequence: h.sequence, timestamp: h.timestamp, next: memoryOfHex(h.nexthash), recovery: memoryOfHex(h.recovery), genesis: memoryOfHex(h.genesis), prev: memoryOfHex(h.prevTx), keyType: h.keyType, nextType: h.nextType });
}

export function txidOf(hashed: Uint8Array): string {
  const hash = sk512(hashed);
  hash[63] = txTypeTritium;
  return hexOfMemory(hash);
}

export interface GenesisParams {
  username: string;
  password: string;
  pin: string;
  //genesis with the network's user type byte
  genesis: string;
  //hybrid and private networks: the -hybrid name (private chains use ""); no proof of work, no default accounts
  hybrid?: string;
  timestamp: number;
  //tries of the proof of work so far, for a progress line
  onProgress?: (tries: number) => void;
}

export interface CryptoKeyHashes {
  auth: string;
  network: string;
  sign: string;
}

//the core's first transaction; key hashes come from keys.ts deriveKey (auth, network, sign)
export async function buildGenesis(p: GenesisParams, keyHashes: CryptoKeyHashes, randomAccount: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): Promise<SignedTx & { trust?: string; default?: string }> {
  const genesisMem = memoryOfHex(p.genesis);
  const ts = p.timestamp;
  const account = Uint8Array.from(randomAccount);
  account[31] = addrAccount;
  const { list, trust } = genesisContracts(p.genesis, ts, keyHashes, p.hybrid !== undefined, account);
  const key = await sequenceKey(p.username, p.password, p.pin, 0);
  const nextKey = await sequenceKey(p.username, p.password, p.pin, 1);
  nextKey.privateKey.fill(0);
  const h: Header = {
    version: 4,
    sequence: 0,
    timestamp: ts,
    next: sk256(nextKey.publicKey),
    recovery: new Uint8Array(32),
    genesis: genesisMem,
    prev: p.hybrid === undefined ? new Uint8Array(64) : sk512(enc.encode(p.hybrid)),
    keyType: keyBrainpool,
    nextType: keyBrainpool,
  };
  if (p.hybrid === undefined) {
    //proof of work: count hashPrevTx up until the proof hash is under the required work
    for (let tries = 1; ; tries++) {
      if (await meetsFirstWork(serializeTx(list, h), genesisMem)) {
        break;
      }
      increment(h.prev);
      if (tries % 1000 === 0) {
        p.onProgress?.(tries);
      }
    }
  }
  try {
    const signed = signHeader(h, list, key);
    return { ...signed, trust: trust && addressOfMemory(trust), default: trust && addressOfMemory(account) };
  } finally {
    key.privateKey.fill(0);
  }
}

//--- new accounts (API/commands/templates/create.cpp) ---

//NAME_FEE: a local name costs 1 NXS, the account itself nothing (ACCOUNT_FEE)
export const nameFee = 1000000n;

//the account's CREATE and, with a name, the CREATE of its local name
export function accountContracts(genesis: string, name: string | undefined, token: string, account: Uint8Array, timestamp: number): Uint8Array[] {
  const owner = memoryOfHex(genesis);
  const list = [createContract(account, accountData(0n, tokenMemory(token)), owner, timestamp)];
  if (name) {
    list.push(createContract(namedAddress(name, owner, addrName), nameData('', name, account), owner, timestamp));
  }
  return list;
}

//a random address for a new account
export function newAccountAddress(): Uint8Array {
  const mem = crypto.getRandomValues(new Uint8Array(32));
  mem[31] = addrAccount;
  return mem;
}

//OP::FEE out of an NXS account, always the last contract
export function feeContract(address: Uint8Array, state: AccountState, fee: bigint, timestamp: number): Uint8Array {
  if (state.token !== '0') {
    throw new Error('fees are paid in NXS');
  }
  if (fee > state.balance) {
    throw new Error('not enough NXS for the fee');
  }
  const op = new Writer().u8(opFee).raw(address).u64(fee).bytes();
  return contract(op, new Uint8Array(0), accountRegister(state, state.balance - fee, timestamp));
}

//--- new tokens, names and assets ---

const addrObject = 0xd4;
const addrToken = 0xd7;
const addrNamespace = 0xda;
const globalNamespace = '~GLOBAL~';
const coin = 1000000n;
//USER_TYPES::ASSET
const userTypeAsset = 3;
//a mutable text field is padded to the next 64 bytes so it can be changed later
const fieldPadding = 64;

//fees of TAO/Register/object.cpp Cost(), in NXS base units
export const globalNameFee = 2000n * coin;
export function tokenFee(supply: bigint): bigint {
  const digits = supply.toString().length - 1;
  const big = BigInt(Math.max(0, digits - 2)) * 100n * coin;
  return big > coin ? big : coin;
}
export function objectFee(size: number): bigint {
  const fee = BigInt(size) * 1000n;
  return fee > coin ? fee : coin;
}

function randomAddress(type: number): Uint8Array {
  const mem = crypto.getRandomValues(new Uint8Array(32));
  mem[31] = type;
  return mem;
}

export const newTokenAddress = () => randomAddress(addrToken);
export const newAssetAddress = () => randomAddress(addrObject);

export function tokenContract(genesis: string, token: Uint8Array, supply: bigint, decimals: number, timestamp: number): Uint8Array {
  return createContract(token, tokenData(supply, token, supply, decimals), memoryOfHex(genesis), timestamp);
}

//a local name lives in the profile's namespace, a global one in the namespace everybody shares
export function nameContract(genesis: string, name: string, register: Uint8Array, global: boolean, timestamp: number): Uint8Array {
  const owner = memoryOfHex(genesis);
  const namespace = global ? sk256(enc.encode(globalNamespace)) : owner;
  if (global) {
    namespace[31] = addrNamespace;
  }
  return createContract(namedAddress(name, namespace, addrName), nameData(global ? globalNamespace : '', name, register), owner, timestamp);
}

//format basic: _usertype, then the fields in name order; text fields stay changeable unless the value starts with const:
export function assetData(fields: Record<string, string>): Uint8Array {
  const w = new Writer();
  w.vec(enc.encode('_usertype')).u8(typeUint16).u8(userTypeAsset).u8(0);
  for (const name of Object.keys(fields).sort()) {
    const fixed = fields[name]!.startsWith('const:');
    const value = enc.encode(fixed ? fields[name]!.slice('const:'.length) : fields[name]!);
    w.vec(enc.encode(name));
    if (fixed) {
      w.u8(typeString).vec(value);
    } else {
      const padded = new Uint8Array((Math.floor(value.length / fieldPadding) + 1) * fieldPadding);
      padded.set(value);
      w.u8(typeMutable).u8(typeString).vec(padded);
    }
  }
  return w.bytes();
}

export function assetContract(genesis: string, asset: Uint8Array, data: Uint8Array, timestamp: number): Uint8Array {
  return createContract(asset, data, memoryOfHex(genesis), timestamp);
}

//for checks against real transactions
export function rawCreateContract(genesis: string, address: Uint8Array, data: Uint8Array, timestamp: number): Uint8Array {
  return createContract(address, data, memoryOfHex(genesis), timestamp);
}

//--- moving registers (assets) between profiles: OP::TRANSFER and OP::CLAIM ---

//TRANSFER::CLAIM: the receiver has to claim it (FORCE would hand it over at once)
const transferClaim = 0xfa;

//a whole register state as serialized in a contract: version, type, owner, created, modified, data
export interface RegisterState {
  version: number;
  type: number;
  owner: Uint8Array;
  created: bigint;
  modified: bigint;
  data: Uint8Array;
}

function stateBytes(s: RegisterState, withChecksum: boolean): Uint8Array {
  const body = new Writer().u8(s.version).u8(s.type).raw(s.owner).u64(s.created).u64(s.modified).vec(s.data).bytes();
  return withChecksum ? new Writer().raw(body).u64(sk64(body)).bytes() : body;
}

function readState(r: Reader): RegisterState {
  const s = { version: r.u8(), type: r.u8(), owner: Uint8Array.from(r.take(32)), created: r.u64(), modified: r.u64(), data: Uint8Array.from(r.vec()) };
  r.u64();
  return s;
}

//the state of a register right after a transaction that touched it, from that transaction's raw form;
//a creation carries the data, a transfer or claim the whole state before it
export function stateAfter(rawHex: string, address: Uint8Array): RegisterState {
  const h = parseTx(rawHex);
  const caller = memoryOfHex(h.genesis);
  //a transaction may create a register and send it on (invoices): the last contract on it counts
  let found: RegisterState | null = null;
  for (const c of h.contractBytes) {
    const r = new Reader(c);
    const op = new Reader(r.vec());
    r.vec();
    const reg = new Reader(r.vec());
    let code = op.u8();
    if (code === opCondition) {
      code = op.u8();
    }
    if (code === opCreate) {
      if (!same(op.take(32), address)) {
        continue;
      }
      const type = op.u8();
      found = { version: stateVersion, type, owner: caller, created: BigInt(h.timestamp), modified: BigInt(h.timestamp), data: Uint8Array.from(op.vec()) };
      continue;
    }
    if (code === opTransfer || code === opClaim) {
      if (code === opClaim) {
        op.take(68);
      }
      if (!same(op.take(32), address)) {
        continue;
      }
      reg.u8();
      const before = readState(reg);
      let owner = caller;
      if (code === opTransfer) {
        const recipient = op.take(32);
        //FORCE goes straight to the receiver, CLAIM keeps it in the sender's name with the system type on top
        owner = op.u8() === transferClaim ? Uint8Array.from(caller) : Uint8Array.from(recipient);
        if (owner === caller || same(owner, caller)) {
          owner[31] = 0x00;
        }
      }
      found = { ...before, owner, modified: BigInt(h.timestamp) };
    }
  }
  if (!found) {
    throw new Error('this transaction did not create, send or claim that register');
  }
  return found;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function registerContract(op: Uint8Array, condition: Uint8Array, before: RegisterState, after: RegisterState): Uint8Array {
  const reg = new Writer().u8(statePre).raw(stateBytes(before, true)).u8(statePost).u64(sk64(stateBytes(after, false))).bytes();
  return contract(op, condition, reg);
}

//to another profile, kept by the system until claimed; the sender's genesis with type 0x00 is the owner meanwhile
export function transferContract(genesis: string, address: Uint8Array, recipient: string, state: RegisterState, condition: Uint8Array, timestamp: number): Uint8Array {
  const op = new Writer().u8(opTransfer).raw(address).raw(memoryOfHex(recipient)).u8(transferClaim).bytes();
  const owner = memoryOfHex(genesis);
  owner[31] = 0x00;
  return registerContract(op, condition, state, { ...state, owner, modified: BigInt(timestamp) });
}

//claim of a register sent to this profile: transfer txid, its contract number, the register
export function claimContract(genesis: string, transferTxid: string, contractId: number, address: Uint8Array, state: RegisterState, timestamp: number): Uint8Array {
  const op = new Writer().u8(opClaim).raw(memoryOfHex(transferTxid)).u32(contractId).raw(address).bytes();
  return registerContract(op, new Uint8Array(0), state, { ...state, owner: memoryOfHex(genesis), modified: BigInt(timestamp) });
}

//--- invoices (API/commands/invoices: create.cpp, pay.cpp; cancel = void of the transfer) ---

const registerReadonly = 0x01;
const addrReadonly = 0xd1;
//USER_TYPES::INVOICE
const userTypeInvoice = 2;
const condOps = { operations: 0xc2, contains: 0x84, bytes: 0x78, prestateValue: 0xc9, contractGenesis: 0xca };

export const newInvoiceAddress = () => randomAddress(addrReadonly);

//register data: u16 user type, then the invoice json as a string
export function invoiceData(json: string): Uint8Array {
  return new Writer().u8(userTypeInvoice).u8(0).vec(enc.encode(json)).bytes();
}

//the invoice register, then its conditional transfer to the payer: claimable by a transaction that also debits the
//total into the issuer's account in the invoice's token, or by the issuer (cancel)
export function invoiceContracts(genesis: string, invoice: Uint8Array, data: Uint8Array, payer: string, account: Uint8Array, token: Uint8Array, total: bigint, timestamp: number): Uint8Array[] {
  const owner = memoryOfHex(genesis);
  const create = createContract(invoice, data, owner, timestamp, registerReadonly);
  const op = new Writer().u8(opCondition).u8(opTransfer).raw(invoice).raw(memoryOfHex(payer)).u8(transferClaim).bytes();
  const condition = payBackCondition(account, total, token);
  const state: RegisterState = { version: stateVersion, type: registerReadonly, owner, created: BigInt(timestamp), modified: BigInt(timestamp), data };
  const inTransfer = Uint8Array.from(owner);
  inTransfer[31] = 0x00;
  return [create, registerContract(op, condition, state, { ...state, owner: inTransfer })];
}

//claimable by a transaction that also debits total into account in token, or by the maker (cancel)
function payBackCondition(account: Uint8Array, total: bigint, token: Uint8Array): Uint8Array {
  const expected = new Writer().u8(opDebit).raw(new Uint8Array(32)).raw(account).u64(total).u64(0n).bytes();
  return new Writer()
    .u8(cond.group)
    .u8(condOps.operations)
    .u8(condOps.contains)
    .u8(condOps.bytes)
    .vec(expected)
    .u8(cond.and)
    .u8(condOps.prestateValue)
    .vec(enc.encode('token'))
    .u8(cond.equals)
    .u8(cond.uint256)
    .raw(token)
    .u8(cond.ungroup)
    .u8(cond.or)
    .u8(cond.group)
    .u8(cond.callerGenesis)
    .u8(cond.equals)
    .u8(condOps.contractGenesis)
    .u8(cond.ungroup)
    .bytes();
}

//what an invoice asks: account and total, read from its transfer condition (exact, the json amount is a double)
export function invoiceTerms(rawHex: string, invoice: Uint8Array): { contract: number; account: Uint8Array; total: bigint } {
  const h = parseTx(rawHex);
  for (let i = 0; i < h.contractBytes.length; i++) {
    const r = new Reader(h.contractBytes[i]!);
    const op = new Reader(r.vec());
    const condition = new Reader(r.vec());
    if (op.u8() !== opCondition || op.u8() !== opTransfer || !same(op.take(32), invoice)) {
      continue;
    }
    //group, operations, contains, bytes, then the expected debit
    condition.take(4);
    const expected = new Reader(condition.vec());
    expected.u8();
    expected.take(32);
    return { contract: i, account: Uint8Array.from(expected.take(32)), total: expected.u64() };
  }
  throw new Error('this transaction did not send that invoice');
}

//pays an invoice: VALIDATE of its transfer with the debit inside, a claim of the invoice register
export function invoicePayment(genesis: string, invoiceTxid: string, contractId: number, invoice: Uint8Array, invoiceState: RegisterState, from: { address: string; state: AccountState }, account: Uint8Array, total: bigint, timestamp: number): Uint8Array[] {
  if (total > from.state.balance) {
    throw new Error('amount is more than the balance');
  }
  const op = new Writer().u8(opValidate).raw(memoryOfHex(invoiceTxid)).u32(contractId).u8(opDebit).raw(memoryOfAddress(from.address)).raw(account).u64(total).u64(0n).bytes();
  const condition = new Writer().u8(cond.callerGenesis).u8(cond.notEquals).u8(condOps.contractGenesis).bytes();
  const pay = contract(op, condition, accountRegister(from.state, from.state.balance - total, timestamp));
  return [pay, claimContract(genesis, invoiceTxid, contractId, invoice, invoiceState, timestamp)];
}

//--- market orders (API/commands/market: create.cpp, execute.cpp; cancel = void) ---

//WILDCARD_ADDRESS: the order's debit can be credited into any account
const wildcard = new Uint8Array(32).fill(0xff);

//an order: the maker's amount, credited by whoever also pays the asked amount into the maker's deposit account
export function orderContract(from: { address: string; state: AccountState }, amount: bigint, deposit: Uint8Array, ask: bigint, askToken: Uint8Array, timestamp: number): Uint8Array {
  if (amount > from.state.balance) {
    throw new Error('amount is more than the balance');
  }
  const op = new Writer().u8(opCondition).u8(opDebit).raw(memoryOfAddress(from.address)).raw(wildcard).u64(amount).u64(0n).bytes();
  return contract(op, payBackCondition(deposit, ask, askToken), accountRegister(from.state, from.state.balance - amount, timestamp));
}

export interface OrderTerms {
  contract: number;
  from: Uint8Array;
  amount: bigint;
  deposit: Uint8Array;
  ask: bigint;
  askToken: Uint8Array;
}

//the order's terms from its raw transaction
export function orderTerms(rawHex: string): OrderTerms {
  const h = parseTx(rawHex);
  for (let i = 0; i < h.contractBytes.length; i++) {
    const r = new Reader(h.contractBytes[i]!);
    const op = new Reader(r.vec());
    const condition = new Reader(r.vec());
    if (op.u8() !== opCondition || op.u8() !== opDebit) {
      continue;
    }
    const from = Uint8Array.from(op.take(32));
    if (!same(op.take(32), wildcard)) {
      continue;
    }
    const amount = op.u64();
    condition.take(4);
    const expected = new Reader(condition.vec());
    expected.u8();
    expected.take(32);
    const deposit = Uint8Array.from(expected.take(32));
    const ask = expected.u64();
    //and, prestate value, "token", equals, uint256
    condition.take(2);
    condition.vec();
    condition.take(2);
    return { contract: i, from, amount, deposit, ask, askToken: Uint8Array.from(condition.take(32)) };
  }
  throw new Error('this transaction has no market order');
}

//fills an order: pays the asked amount into the maker's deposit, credits the order's amount into an own account
export function fillContracts(genesis: string, orderTxid: string, terms: OrderTerms, pay: { address: string; state: AccountState }, receive: { address: string; state: AccountState }, timestamp: number): Uint8Array[] {
  if (terms.ask > pay.state.balance) {
    throw new Error('not enough to pay this order');
  }
  const op = new Writer().u8(opValidate).raw(memoryOfHex(orderTxid)).u32(terms.contract).u8(opDebit).raw(memoryOfAddress(pay.address)).raw(terms.deposit).u64(terms.ask).u64(0n).bytes();
  const condition = new Writer().u8(cond.callerGenesis).u8(cond.notEquals).u8(condOps.contractGenesis).bytes();
  const payment = contract(op, condition, accountRegister(pay.state, pay.state.balance - terms.ask, timestamp));
  void genesis;
  return [payment, creditContract({ debitTxid: orderTxid, contract: terms.contract, to: receive, from: addressOfMemory(terms.from), amount: terms.amount }, timestamp)];
}
