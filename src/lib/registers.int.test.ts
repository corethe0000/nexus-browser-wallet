//real mainnet transactions that made tokens, names and assets: same contracts, fee as computed; reads only
//REG_NODE=http://node3.nexus.io:8080 REG_FILE=<json: {asset:[txid:type:n], token:[...], name:[...]}> npx vitest run src/lib/registers.int.test.ts
import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { globalNameFee, nameFee, objectFee, parseTx, rawCreateContract, tokenContract, tokenFee, nameContract } from './tritium';
import { toHex } from './keys';

const node = process.env.REG_NODE;
const file = process.env.REG_FILE;
const found: Record<string, string[]> = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

async function call(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  return (await res.json()).result;
}

function parts(c: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let p = 0;
  for (let i = 0; i < 3; i++) {
    let n = c[p]!;
    p += 1;
    if (n === 253) {
      n = c[p]! | (c[p + 1]! << 8);
      p += 2;
    }
    out.push(c.subarray(p, p + n));
    p += n;
  }
  return out;
}

const u64 = (b: Uint8Array, at: number) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(b[at + i]!);
  }
  return v;
};

//op = 0x02, address, type, compact size, data
function createData(op: Uint8Array): Uint8Array {
  const first = op[34]!;
  return op.subarray(first === 253 ? 37 : 35);
}

function nameFields(data: Uint8Array): { namespace: string; name: string; register: Uint8Array } {
  let p = 0;
  const text = () => {
    const n = data[p]!;
    const v = new TextDecoder().decode(data.subarray(p + 1, p + 1 + n));
    p += 1 + n;
    return v;
  };
  text();
  p += 1;
  const namespace = text();
  text();
  p += 1;
  const name = text();
  text();
  p += 2;
  return { namespace, name, register: data.subarray(p, p + 32) };
}

const feeOf = (c: Uint8Array) => u64(parts(c)[0]!, 33);

describe.skipIf(!node || !file)('new registers like the core makes them', () => {
  for (const e of found.token ?? []) {
    const txid = e.split(':')[0]!;
    it(`token ${txid.slice(0, 16)}`, async () => {
      const h = parseTx((await call('ledger/get/transaction', { hash: txid, format: 'raw' })).data);
      const op = parts(h.contractBytes[0]!)[0]!;
      const token = op.slice(1, 33);
      const data = createData(op);
      //balance: name(8) 0xff 0x04 value; token: name(6) 0x05 32; supply: name(7) 0x04 value; decimals: name(9) 0x01 value
      const supply = u64(data, 8 + 2 + 8 + 6 + 1 + 32 + 7 + 1);
      const decimals = data[data.length - 1]!;
      expect(toHex(tokenContract(h.genesis, token, supply, decimals, h.timestamp))).toBe(toHex(h.contractBytes[0]!));
      let expected = tokenFee(supply);
      if (h.contracts === 3) {
        const f = nameFields(createData(parts(h.contractBytes[1]!)[0]!));
        expect(toHex(nameContract(h.genesis, f.name, f.register, true, h.timestamp))).toBe(toHex(h.contractBytes[1]!));
        expected += globalNameFee;
      }
      expect(feeOf(h.contractBytes[h.contracts - 1]!)).toBe(expected);
    }, 60000);
  }
  for (const e of found.name ?? []) {
    const txid = e.split(':')[0]!;
    it(`name ${txid.slice(0, 16)}`, async () => {
      const h = parseTx((await call('ledger/get/transaction', { hash: txid, format: 'raw' })).data);
      const f = nameFields(createData(parts(h.contractBytes[0]!)[0]!));
      const global = f.namespace === '~GLOBAL~';
      if (f.namespace && !global) {
        return; //a name in an own namespace, not built here
      }
      expect(toHex(nameContract(h.genesis, f.name, f.register, global, h.timestamp))).toBe(toHex(h.contractBytes[0]!));
      expect(feeOf(h.contractBytes[1]!)).toBe(global ? globalNameFee : nameFee);
    }, 60000);
  }
  for (const e of found.asset ?? []) {
    const txid = e.split(':')[0]!;
    it(`asset ${txid.slice(0, 16)}`, async () => {
      const h = parseTx((await call('ledger/get/transaction', { hash: txid, format: 'raw' })).data);
      const op = parts(h.contractBytes[0]!)[0]!;
      const data = createData(op);
      expect(toHex(rawCreateContract(h.genesis, op.slice(1, 33), data, h.timestamp))).toBe(toHex(h.contractBytes[0]!));
      expect(feeOf(h.contractBytes[h.contracts - 1]!)).toBe(objectFee(data.length) + (h.contracts === 3 ? nameFee : 0n));
    }, 60000);
  }
});
