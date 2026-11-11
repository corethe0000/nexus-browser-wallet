//Skein as built into the Nexus core (src/LLC/hash/SK/skein*.cpp): key schedule parity 0x5555..., its rotation
//constants and tree info 0 in the config, which differ from the final Skein 1.3. Skein-256 for SK256 and SK64,
//Skein-512 for SK512 (transaction ids)

const mask = (1n << 64n) - 1n;
const ksParity = 0x5555555555555555n;
const rounds = 72;

//rotation constants per round (mod 8), per word pair
const rot256 = [
  [5, 56],
  [36, 28],
  [13, 46],
  [58, 44],
  [26, 20],
  [53, 35],
  [11, 42],
  [59, 50],
];
const rot512 = [
  [38, 30, 50, 53],
  [48, 20, 43, 31],
  [34, 14, 15, 27],
  [26, 12, 58, 7],
  [33, 49, 8, 42],
  [39, 27, 41, 14],
  [29, 26, 11, 9],
  [33, 51, 39, 35],
];
//word pairs mixed in each round (mod 4)
const perm256 = [
  [0, 1, 2, 3],
  [0, 3, 2, 1],
];
const perm512 = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [2, 1, 4, 7, 6, 5, 0, 3],
  [4, 1, 6, 3, 0, 5, 2, 7],
  [6, 1, 0, 7, 2, 5, 4, 3],
];

const typeCfg = 4n;
const typeMsg = 48n;
const typeOut = 63n;
const flagFirst = 1n << 62n;
const flagFinal = 1n << 63n;
//schema "SHA3" version 1, tree info 0 (sequential in this Skein version)
const schemaVersion = (1n << 32n) | 0x33414853n;
const cfgBytes = 32;

function rotl(x: bigint, r: number): bigint {
  return ((x << BigInt(r)) | (x >> BigInt(64 - r))) & mask;
}

function readWords(block: Uint8Array, n: number): bigint[] {
  const w: bigint[] = [];
  for (let i = 0; i < n; i++) {
    let v = 0n;
    for (let b = 7; b >= 0; b--) {
      v = (v << 8n) | BigInt(block[i * 8 + b]!);
    }
    w.push(v);
  }
  return w;
}

function writeWords(words: bigint[]): Uint8Array {
  const out = new Uint8Array(words.length * 8);
  words.forEach((v, i) => {
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number((v >> BigInt(8 * b)) & 0xffn);
    }
  });
  return out;
}

//one UBI block: Threefish with plaintext feed forward
function processBlock(h: bigint[], block: Uint8Array, t0: bigint, t1: bigint): bigint[] {
  const n = h.length;
  const rot = n === 4 ? rot256 : rot512;
  const perm = n === 4 ? perm256 : perm512;
  const w = readWords(block, n);
  const ks = [...h, h.reduce((a, b) => a ^ b, ksParity)];
  const ts = [t0, t1, t0 ^ t1];
  const inject = (x: bigint[], s: number) => {
    for (let i = 0; i < n; i++) {
      let v = x[i]! + ks[(s + i) % (n + 1)]!;
      if (i === n - 3) {
        v += ts[s % 3]!;
      } else if (i === n - 2) {
        v += ts[(s + 1) % 3]!;
      } else if (i === n - 1) {
        v += BigInt(s);
      }
      x[i] = v & mask;
    }
  };
  const x = [...w];
  inject(x, 0);
  for (let d = 0; d < rounds; d++) {
    const r = rot[d % 8]!;
    const p = perm[d % perm.length]!;
    for (let j = 0; j < n / 2; j++) {
      const a = p[2 * j]!;
      const b = p[2 * j + 1]!;
      x[a] = (x[a]! + x[b]!) & mask;
      x[b] = rotl(x[b]!, r[j]!) ^ x[a]!;
    }
    if ((d + 1) % 4 === 0) {
      inject(x, (d + 1) / 4);
    }
  }
  return x.map((v, i) => v ^ w[i]!);
}

//chaining value after the config block, the same numbers as the core's precomputed IVs
function initialValue(stateBytes: number, outBits: number): bigint[] {
  const cfg = new Uint8Array(stateBytes);
  cfg.set(writeWords([schemaVersion, BigInt(outBits), 0n]));
  return processBlock(new Array(stateBytes / 8).fill(0n), cfg, BigInt(cfgBytes), (typeCfg << 56n) | flagFirst | flagFinal);
}

const ivCache = new Map<string, bigint[]>();

export function skein(data: Uint8Array, stateBits: 256 | 512, outBits: number): Uint8Array {
  const stateBytes = stateBits / 8;
  const key = `${stateBits}/${outBits}`;
  if (!ivCache.has(key)) {
    ivCache.set(key, initialValue(stateBytes, outBits));
  }
  let h = [...ivCache.get(key)!];
  //every block but the last is processed as it comes, the last one carries the final flag
  const count = Math.max(1, Math.ceil(data.length / stateBytes));
  let pos = 0n;
  for (let i = 0; i < count; i++) {
    const chunk = data.subarray(i * stateBytes, (i + 1) * stateBytes);
    const block = new Uint8Array(stateBytes);
    block.set(chunk);
    pos += BigInt(chunk.length);
    let t1 = typeMsg << 56n;
    if (i === 0) {
      t1 |= flagFirst;
    }
    if (i === count - 1) {
      t1 |= flagFinal;
    }
    h = processBlock(h, block, pos, t1);
  }
  //output stage: counter 0 as one block (all outputs used here fit in one block)
  const out = processBlock(h, new Uint8Array(stateBytes), 8n, (typeOut << 56n) | flagFirst | flagFinal);
  return writeWords(out).subarray(0, outBits / 8);
}

export function skein256(data: Uint8Array): Uint8Array {
  return skein(data, 256, 256);
}

//for tests: the chaining value the core has precomputed
export function skeinIv(stateBits: 256 | 512, outBits: number): bigint[] {
  return initialValue(stateBits / 8, outBits);
}
