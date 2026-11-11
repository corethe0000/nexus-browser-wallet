//sigchain keys the same way the Nexus core makes them (src/TAO/Ledger/credentials.cpp), so the extension can
//sign with the "sign" key of the user's crypto register without the core: Argon2id over username, password
//and PIN, a brainpoolP512t1 key from that, and SK256 (SHA3-256 of Skein-256) of the public key as key hash
import { argon2id } from 'hash-wasm';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { ecdsa, weierstrass } from '@noble/curves/abstract/weierstrass.js';
import { skein256 } from './skein';

//RFC 5639, same numbers as openssl ecparam -name brainpoolP512t1
const brainpoolP512t1 = weierstrass({
  p: 0xaadd9db8dbe9c48b3fd4e6ae33c9fc07cb308db3b3c9d20ed6639cca703308717d4d9b009bc66842aecda12ae6a380e62881ff2f2d82c68528aa6056583a48f3n,
  n: 0xaadd9db8dbe9c48b3fd4e6ae33c9fc07cb308db3b3c9d20ed6639cca70330870553e5c414ca92619418661197fac10471db1d381085ddaddb58796829ca90069n,
  h: 1n,
  a: 0xaadd9db8dbe9c48b3fd4e6ae33c9fc07cb308db3b3c9d20ed6639cca703308717d4d9b009bc66842aecda12ae6a380e62881ff2f2d82c68528aa6056583a48f0n,
  b: 0x7cbbbcf9441cfab76e1890e46884eae321f70c0bcb4981527897504bec3e36a62bcdfa2304976540f6450085f2dae145c22553b465763689180ea2571867423en,
  Gx: 0x640ece5c12788717b9c1ba06cbc2a6feba85842458c56dde9db1758d39c0313d82ba51735cdb3ea499aa77a7d6943a64f7a3f25fe26f06b51baa2696fa9035dan,
  Gy: 0x5b534bd595f5af0fa2c892376c84ace1bb4e3019b71634c01131159cae03cee9d9932184beef216bd71df2dadf86a627306ecff96dbb8bace198b61e00f8b332n,
});

//the message is hashed with SHA-512 by us, ECDSA signs that digest
export const signer = ecdsa(brainpoolP512t1, sha512, { lowS: false });

//signature scheme byte in key hashes (TAO::Ledger::SIGNATURE::BRAINPOOL)
export const brainpoolType = 0x02;

//core defaults -argon2=12, -argon2_memory=16 (2^16 KiB = 64 MB), one lane
const argonPasses = 12;
const argonMemoryKiB = 1 << 16;

const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u32le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^([0-9a-f]{2})*$/.test(clean)) {
    throw new Error('bad hex');
  }
  return new Uint8Array(clean.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
}

//uint256_t keeps bytes little endian, the node prints them reversed
function asNodeHex(bytes: Uint8Array): string {
  return toHex(Uint8Array.from(bytes).reverse());
}

function withType(nodeHex: string, type: number): string {
  return type.toString(16).padStart(2, '0') + nodeHex.slice(2);
}

//base_uint SetBytes/GetBytes read and write 32-bit words big endian, so their bytes are swapped per word
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

//genesis id of a username (Argon2_256 then SetBytes), the node puts the network's user type in the first byte
export async function genesisOf(username: string): Promise<string> {
  const hash = await argon2id({
    password: enc.encode(username),
    salt: new Uint8Array(16),
    iterations: argonPasses,
    memorySize: argonMemoryKiB,
    parallelism: 1,
    hashLength: 32,
    outputType: 'binary',
  });
  return asNodeHex(swapWords(hash));
}

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let v = 0n;
  for (const b of bytes) {
    v = (v << 8n) | BigInt(b);
  }
  let s = '';
  while (v > 0n) {
    s = base58Alphabet[Number(v % 58n)] + s;
    v /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) {
      break;
    }
    s = '1' + s;
  }
  return s;
}

//SK256 as the node keeps it in memory (digest bytes as they come)
function sk256(data: Uint8Array): Uint8Array {
  return sha3_256(skein256(data));
}

//register type byte of crypto registers (TAO::Register::Address::CRYPTO)
const cryptoType = 0xd5;

//Address("crypto", genesis, CRYPTO): where the crypto register of a signature chain lives
export function cryptoRegisterAddress(genesisHex: string): string {
  const genesisMemory = fromHex(genesisHex).reverse();
  const mem = sk256(concat(enc.encode('crypto'), genesisMemory));
  mem[31] = cryptoType;
  const payload = concat(new Uint8Array([cryptoType]), swapWords(mem));
  return base58(concat(payload, sk256(payload).subarray(0, 4)));
}

//Credentials::Generate(strType, nKeyID, strSecret): 64 byte secret of one typed key
export async function keySecret(username: string, password: string, pin: string, keyType: string, keyId = 0): Promise<Uint8Array> {
  const id = u32le(keyId);
  let salt = concat(enc.encode(username), id);
  if (salt.length < 8) {
    salt = concat(salt, new Uint8Array(8 - salt.length));
  }
  return argon2id({
    password: concat(enc.encode(password), id),
    salt,
    secret: concat(enc.encode(pin), id, enc.encode(keyType)),
    iterations: argonPasses,
    memorySize: argonMemoryKiB,
    parallelism: 1,
    hashLength: 64,
    outputType: 'binary',
  });
}

//ECKey::SetSecret takes the 64 bytes as a big endian number
export function privateKeyOf(secret: Uint8Array): Uint8Array {
  const n = brainpoolP512t1.Fn.ORDER;
  let v = 0n;
  for (const b of secret) {
    v = (v << 8n) | BigInt(b);
  }
  v %= n;
  if (v === 0n) {
    throw new Error('key secret is zero');
  }
  const out = new Uint8Array(64);
  for (let i = 63; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return signer.getPublicKey(privateKey, true);
}

//Credentials::KeyHash: SK256 of the compressed public key, scheme byte in front
export function keyHash(publicKey: Uint8Array, type = brainpoolType): string {
  return withType(asNodeHex(sha3_256(skein256(publicKey))), type);
}

export async function deriveKey(username: string, password: string, pin: string, keyType: string) {
  const secret = await keySecret(username, password, pin, keyType);
  const privateKey = privateKeyOf(secret);
  secret.fill(0);
  const publicKey = publicKeyOf(privateKey);
  return { privateKey, publicKey, hash: keyHash(publicKey) };
}
