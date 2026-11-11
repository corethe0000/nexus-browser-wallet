//claims payments sent to an account with a CREDIT signed here (no login on the node), on the private test chain
//TRITIUM_NODE=http://127.0.0.1:7080 TRITIUM_DEBITS=<txid,txid> [TRITIUM_SUBMIT=1] npx vitest run src/lib/tritium.claim.int.test.ts
import { describe, expect, it } from 'vitest';
import { creditContract, sequenceKey, signTx, type CreditParams } from './tritium';

const node = process.env.TRITIUM_NODE;
const debits = (process.env.TRITIUM_DEBITS || '').split(',').filter(Boolean);
const submit = process.env.TRITIUM_SUBMIT === '1';
const user = process.env.TRITIUM_USER || 'bob';
const pass = process.env.TRITIUM_PASS || 'bobpass12';
const pin = process.env.TRITIUM_PIN || '2222';
const account = process.env.TRITIUM_ACCOUNT || '8CekfnBTnqNDLZAcwVCQP9ge2jbxnAeh2MbVmpKtKtJVkNnahzM'; //bob:testt
const feeIntervalSeconds = 10;

async function call(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const body = await res.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  }
  return body.result;
}

describe.skipIf(!node || !debits.length)('Tritium credit signed in the browser', () => {
  it('claims the open debits to the account', async () => {
    const acc = await call('register/get/any', { address: account });
    const token = acc.token === '0' ? { decimals: 6 } : await call('register/get/any', { address: acc.token });
    const unit = 10 ** token.decimals;
    const genesis = acc.owner as string;

    //open debits to this account: the node tells "claimed" without any login
    const claims: CreditParams[] = [];
    let balance = BigInt(Math.round(acc.balance * unit));
    for (const txid of debits) {
      const tx = await call('ledger/get/transaction', { hash: txid, verbose: 'summary' });
      for (const c of tx.contracts) {
        const open = Math.round((Number(c.amount) - Number(c.claimed ?? 0)) * unit);
        if (c.OP === 'DEBIT' && c.to?.address === account && open > 0) {
          claims.push({ debitTxid: txid, contract: c.id, to: { address: account, state: { owner: acc.owner, created: acc.created, modified: acc.modified, balance, token: acc.token } }, from: c.from.address, amount: BigInt(open) });
          balance += BigInt(open);
        }
      }
    }
    console.log('open debits', claims.map((c) => `${c.debitTxid.slice(0, 12)}#${c.contract} ${c.amount}`));
    expect(claims.length).toBeGreaterThan(0);
    if (!submit) {
      return;
    }

    const [last] = await call('ledger/list/transactions', { genesis, limit: 1 });
    const prev = await call('ledger/get/transaction', { hash: last.txid, verbose: 'summary' });
    const wait = prev.timestamp + feeIntervalSeconds + 1 - Math.floor(Date.now() / 1000);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    const key = await sequenceKey(user, pass, pin, prev.sequence + 1);
    const nextKey = await sequenceKey(user, pass, pin, prev.sequence + 2);
    //each credit sees the account as the previous credit left it
    const signed = signTx(
      { txid: prev.txid, sequence: prev.sequence, timestamp: prev.timestamp, genesis },
      (ts) => {
        let state = claims[0]!.to.state;
        return claims.map((c) => {
          const out = creditContract({ ...c, to: { address: c.to.address, state } }, ts);
          state = { ...state, balance: state.balance + c.amount, modified: ts };
          return out;
        });
      },
      Math.max(Math.floor(Date.now() / 1000), prev.timestamp),
      key,
      nextKey,
    );
    console.log('built', signed.txid);
    const r = await call('ledger/submit/transaction', { data: signed.data });
    console.log('node answer', JSON.stringify(r));
    expect(r?.hash).toBe(signed.txid);
  }, 240000);
});
