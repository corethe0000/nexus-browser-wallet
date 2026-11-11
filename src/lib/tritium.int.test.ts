//a debit built and signed here, sent with ledger/submit/transaction (no login on the node), on the private test chain
//TRITIUM_NODE=http://127.0.0.1:7080 [TRITIUM_SUBMIT=1] npx vitest run src/lib/tritium.int.test.ts
import { describe, expect, it } from 'vitest';
import { genesisOf } from './keys';
import { debitContract, nextHashOf, parseTx, sequenceKey, signTx } from './tritium';

const node = process.env.TRITIUM_NODE;
const submit = process.env.TRITIUM_SUBMIT === '1';
const user = process.env.TRITIUM_USER || 'alice';
const pass = process.env.TRITIUM_PASS || 'alicepass1';
const pin = process.env.TRITIUM_PIN || '1111';
const from = process.env.TRITIUM_FROM || '8BoheBPAFeWSKKSzWuQLxVbVz8wbKW6ZVLmgLU2mmUA9xp5FHkb'; //alice:testt
const to = process.env.TRITIUM_TO || '8CekfnBTnqNDLZAcwVCQP9ge2jbxnAeh2MbVmpKtKtJVkNnahzM'; //bob:testt
//no fee when the last tx of the chain is older than this (TX_FEE_INTERVAL)
const feeIntervalSeconds = 10;

async function call(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const body = await res.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  }
  return body.result;
}

describe.skipIf(!node)('Tritium debit signed in the browser', () => {
  it('keys match the chain, the node takes the transaction', async () => {
    //the node puts the network's user type in the first byte, the rest comes from the username
    const acc = await call('register/get/any', { address: from });
    const genesis = acc.owner as string;
    expect((await genesisOf(user)).slice(2)).toBe(genesis.slice(2));
    const [last] = await call('ledger/list/transactions', { genesis, limit: 1 });
    const prev = await call('ledger/get/transaction', { hash: last.txid, verbose: 'detail' });
    expect(prev.genesis).toBe(genesis);

    //the key of the last sequence gives its public key, the next one its next hash
    const key = await sequenceKey(user, pass, pin, prev.sequence + 1);
    const lastKey = await sequenceKey(user, pass, pin, prev.sequence);
    const nextKey = await sequenceKey(user, pass, pin, prev.sequence + 2);
    const detail = prev;
    expect(Buffer.from(lastKey.publicKey).toString('hex')).toBe(detail.pubkey);
    expect(nextHashOf(key.publicKey)).toBe(detail.nexthash);
    //the raw form gives the header fields the json leaves out (recovery hash, key types)
    const raw = await call('ledger/get/transaction', { hash: last.txid, format: 'raw' });
    const head = parseTx(raw.data);
    expect(head.sequence).toBe(prev.sequence);
    expect(head.genesis).toBe(genesis);
    expect(head.nexthash).toBe(prev.nexthash);
    expect(head.prevTx).toBe(prev.prevhash);
    console.log('recovery', head.recovery, 'key types', head.keyType, head.nextType);
    console.log('keys of sequence', prev.sequence, 'and', prev.sequence + 1, 'match the chain');

    if (!submit) {
      return;
    }
    const wait = prev.timestamp + feeIntervalSeconds + 1 - Math.floor(Date.now() / 1000);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    const token = acc.token === '0' ? { decimals: 6 } : await call('register/get/any', { address: acc.token });
    const unit = 10 ** token.decimals;
    const signed = signTx(
      { txid: prev.txid, sequence: prev.sequence, timestamp: prev.timestamp, genesis },
      (ts) => [
        debitContract(
          {
            from: { address: from, state: { owner: acc.owner, created: acc.created, modified: acc.modified, balance: BigInt(Math.round(acc.balance * unit)), token: acc.token } },
            to,
            amount: 1n,
            reference: 7n,
          },
          ts,
        ),
      ],
      Math.max(Math.floor(Date.now() / 1000), prev.timestamp),
      key,
      nextKey,
    );
    console.log('built', signed.txid, 'bytes', signed.data.length / 2);
    const r = await call('ledger/submit/transaction', { data: signed.data });
    console.log('node answer', JSON.stringify(r));
    expect(r?.hash).toBe(signed.txid);
  }, 240000);
});
