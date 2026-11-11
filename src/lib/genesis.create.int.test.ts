//a new profile made in the extension and sent with ledger/submit/transaction, on the private test chain
//TRITIUM_NODE=http://127.0.0.1:7080 [TRITIUM_SUBMIT=1] npx vitest run src/lib/genesis.create.int.test.ts
import { describe, expect, it } from 'vitest';
import { deriveKey, genesisOf, cryptoRegisterAddress } from './keys';
import { buildGenesis, meetsFirstWork } from './tritium';

const node = process.env.TRITIUM_NODE;
const submit = process.env.TRITIUM_SUBMIT === '1';
//private chains are hybrid networks: genesis type 0xb7, network id SK512("")
const userType = process.env.TRITIUM_USER_TYPE || 'b7';
const powSample = 200;

async function call(method: string, params: Record<string, unknown>) {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const body = await res.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  }
  return body.result;
}

describe('proof of work speed', () => {
  it('times the Argon2 of a first transaction', async () => {
    const data = new Uint8Array(1200);
    const salt = new Uint8Array(32);
    const t0 = Date.now();
    for (let i = 0; i < powSample; i++) {
      data[0] = i & 0xff;
      data[1] = i >> 8;
      await meetsFirstWork(data, salt);
    }
    const ms = (Date.now() - t0) / powSample;
    //on average 65536 tries for 16 zero bits
    console.log(`proof of work: ${ms.toFixed(2)} ms per try, about ${Math.round((ms * 65536) / 1000)} s on average`);
  }, 120000);
});

describe.skipIf(!node)('new profile signed in the browser', () => {
  it('makes the first transaction, the node takes it', async () => {
    const username = `ext${Date.now().toString(36).slice(-6)}`;
    const password = 'extpass123';
    const pin = '4242';
    const genesis = userType + (await genesisOf(username)).slice(2);
    const keys = await Promise.all(['auth', 'network', 'sign'].map((t) => deriveKey(username, password, pin, t)));
    keys.forEach((k) => k.privateKey.fill(0));
    const signed = await buildGenesis({ username, password, pin, genesis, hybrid: '', timestamp: Math.floor(Date.now() / 1000) }, { auth: keys[0]!.hash, network: keys[1]!.hash, sign: keys[2]!.hash });
    console.log('profile', username, 'txid', signed.txid);
    if (!submit) {
      return;
    }
    const r = await call('ledger/submit/transaction', { data: signed.data });
    expect(r?.hash).toBe(signed.txid);
    //after the next block the crypto register is there with our auth key
    let reg: any = null;
    for (let i = 0; i < 24 && !reg; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      reg = await call('register/get/crypto', { address: cryptoRegisterAddress(genesis) }).catch(() => null);
    }
    expect(reg?.owner).toBe(genesis);
    expect(reg?.auth).toBe(keys[0]!.hash);
    console.log('crypto register on chain for', username);
  }, 240000);
});
