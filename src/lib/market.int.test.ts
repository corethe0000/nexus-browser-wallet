//real orders on a node: the extension writes the same order operation and condition; reads only
//MARKET_NODE=http://node3.nexus.io:8080 MARKET=CARBON/NXS npx vitest run src/lib/market.int.test.ts
import { describe, expect, it } from 'vitest';
import { addressOfMemory, orderContract, orderTerms, parseTx } from './tritium';
import { toHex } from './keys';

const node = process.env.MARKET_NODE;
const market = process.env.MARKET || 'CARBON/NXS';

async function call(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  return (await res.json()).result;
}

//operation and condition vectors of a contract (the register part depends on the account at that time)
function head(c: Uint8Array): string {
  let p = 0;
  for (let i = 0; i < 2; i++) {
    let n = c[p]!;
    p += 1;
    if (n === 253) {
      n = c[p]! | (c[p + 1]! << 8);
      p += 2;
    }
    p += n;
  }
  return toHex(c.subarray(0, p));
}

describe.skipIf(!node)('market orders like the core makes them', () => {
  it('rebuilds open orders of a pair', async () => {
    const r = await call('market/list/order', { market, limit: 4 });
    const list = [...(r?.bids ?? []), ...(r?.asks ?? [])].slice(0, 4);
    expect(list.length).toBeGreaterThan(0);
    for (const o of list) {
      const raw = await call('ledger/get/transaction', { hash: o.txid, format: 'raw' });
      const h = parseTx(raw.data);
      const terms = orderTerms(raw.data);
      const state = { owner: h.genesis, created: 0, modified: 0, balance: terms.amount, token: '0' };
      const built = orderContract({ address: addressOfMemory(terms.from), state }, terms.amount, terms.deposit, terms.ask, terms.askToken, h.timestamp);
      expect(head(built), o.txid.slice(0, 16)).toBe(head(h.contractBytes[terms.contract]!));
    }
  }, 120000);
});
