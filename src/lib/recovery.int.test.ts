//the recovery key against a real recovery hash on a chain; frank on the multi-user test node, phrase from tests/e2e/account.mjs
//RECOVERY_NODE=http://127.0.0.1:7081 npx vitest run src/lib/recovery.int.test.ts
import { describe, expect, it } from 'vitest';
import { nextHashOf, parseTx, recoveryKey } from './tritium';

const node = process.env.RECOVERY_NODE;
const genesis = 'b74df460dff1c4e2b26540ec1c3b534bd6ce1a0238f999caaf24a85869bce6e1';
const phrase = 'the quick brown fox jumps over the lazy dog near the river bank';

async function call(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  return (await res.json()).result;
}

describe.skipIf(!node)('recovery key like the core', () => {
  it('gives the recovery hash on chain', async () => {
    const [last] = await call('ledger/list/transactions', { genesis, limit: 1 });
    const raw = await call('ledger/get/transaction', { hash: last.txid, format: 'raw' });
    const key = await recoveryKey(phrase, 0xb7);
    expect(nextHashOf(key.publicKey)).toBe(parseTx(raw.data).recovery);
  }, 120000);
});
