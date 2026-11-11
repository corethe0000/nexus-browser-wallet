//rebuilds real first transactions of mainnet profiles from their public parts: same contract bytes, same txid,
//proof of work passes; reads only, nothing is sent
//GENESIS_NODE=http://node3.nexus.io:8080 GENESIS_TXIDS=<txid,txid> npx vitest run src/lib/genesis.int.test.ts
import { describe, expect, it } from 'vitest';
import { genesisContracts, hashedForm, meetsFirstWork, memoryOfHex, parseTx, txidOf } from './tritium';
import { cryptoRegisterAddress, toHex } from './keys';

const node = process.env.GENESIS_NODE;
const txids = (process.env.GENESIS_TXIDS || '').split(',').filter(Boolean);
//create contract: vec(op) where op = 0x02 + address (32) + type + vec(data)
const addressOffset = 2;

async function call(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const body = await res.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  }
  return body.result;
}

describe.skipIf(!node || !txids.length)('first transaction of a profile like the core makes it', () => {
  for (const txid of txids) {
    it(`rebuilds ${txid.slice(0, 16)}`, async () => {
      const raw = await call('ledger/get/transaction', { hash: txid, format: 'raw' });
      const h = parseTx(raw.data);
      expect(h.sequence).toBe(0);
      const crypto = await call('register/get/crypto', { address: cryptoRegisterAddress(h.genesis) });
      //the default account address is random, taken from the transaction itself
      const account = h.contractBytes[3]!.subarray(addressOffset, addressOffset + 32);
      const { list } = genesisContracts(h.genesis, h.timestamp, { auth: crypto.auth, network: crypto.network, sign: crypto.sign }, false, account);
      expect(list.length).toBe(h.contracts);
      list.forEach((c, i) => expect(toHex(c), `contract ${i}`).toBe(toHex(h.contractBytes[i]!)));
      const hashed = hashedForm(list, h);
      expect(txidOf(hashed)).toBe(txid);
      expect(await meetsFirstWork(hashed, memoryOfHex(h.genesis))).toBe(true);
    }, 60000);
  }
});
