//rebuilds real mainnet transactions that made a named account and paid the fee: same contract bytes, same txid;
//reads only, nothing is sent
//ACCOUNT_NODE=http://node3.nexus.io:8080 ACCOUNT_TXIDS=<txid,txid> npx vitest run src/lib/account.int.test.ts
import { describe, expect, it } from 'vitest';
import { accountContracts, addressOfMemory, feeContract, hashedForm, nameFee, parseTx, txidOf, hexOfMemory } from './tritium';
import { fromHex, toHex } from './keys';

const node = process.env.ACCOUNT_NODE;
const txids = (process.env.ACCOUNT_TXIDS || '').split(',').filter(Boolean);

async function call(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  return (await res.json()).result;
}

//CompactSize vectors of a contract: operation, condition, register
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

describe.skipIf(!node || !txids.length)('new account like the core makes it', () => {
  for (const txid of txids) {
    it(`rebuilds ${txid.slice(0, 16)}`, async () => {
      const raw = await call('ledger/get/transaction', { hash: txid, format: 'raw' });
      const h = parseTx(raw.data);
      expect(h.contracts).toBe(3);
      const [create, name, fee] = h.contractBytes as [Uint8Array, Uint8Array, Uint8Array];
      //create: 0x02, address, type, vec(data); data ends with the token's 32 bytes
      const op = parts(create)[0]!;
      const account = op.slice(1, 33);
      const tokenMem = op.slice(op.length - 32);
      const token = tokenMem.every((b) => b === 0) ? '0' : addressOfMemory(tokenMem);
      //name data: vec(namespace) 0x08 vec("") vec(name) 0x08 vec(value) ...
      const nameOp = parts(name)[0]!;
      //after 0x02, address, type and the size of the data
      const data = nameOp.subarray(35);
      let p = 0;
      const text = () => {
        const n = data[p]!;
        const v = new TextDecoder().decode(data.subarray(p + 1, p + 1 + n));
        p += 1 + n;
        return v;
      };
      text(); //'namespace'
      p += 1;
      text(); //value, empty for a local name
      text(); //'name'
      p += 1;
      const label = text();
      const list = accountContracts(h.genesis, label, token, account, h.timestamp);
      expect(toHex(list[0]!), 'account').toBe(toHex(create));
      expect(toHex(list[1]!), 'name').toBe(toHex(name));
      //fee: pre-state taken from the transaction itself
      const feeOp = parts(fee)[0]!;
      expect(u64(feeOp, 33)).toBe(nameFee);
      const reg = parts(fee)[2]!;
      const stateData = reg.subarray(1 + 1 + 1 + 32 + 16 + 1);
      const balance = u64(stateData, 1 + 7 + 2);
      const state = { owner: hexOfMemory(reg.subarray(3, 35)), created: Number(u64(reg, 35)), modified: Number(u64(reg, 43)), balance, token: '0' };
      const built = feeContract(feeOp.slice(1, 33), state, nameFee, h.timestamp);
      expect(toHex(built), 'fee').toBe(toHex(fee));
      expect(txidOf(hashedForm([list[0]!, list[1]!, built], h))).toBe(txid);
      expect(fromHex(txid).length).toBe(64);
    }, 60000);
  }
});
