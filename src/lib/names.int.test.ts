//name lookups of the no-login wallet against a multi-user node (names/get wants a session there), checked against
//names/get/name of a single-user node; reads only
//NAMES_NODE=http://node1.nexus.io:8080 NAMES_REF=http://node3.nexus.io:8080 NAMES_GENESIS=<profile with a default account> npx vitest run src/lib/names.int.test.ts
import { describe, expect, it } from 'vitest';
import { LocalWallet } from './local-wallet';

const node = process.env.NAMES_NODE;
const ref = process.env.NAMES_REF;
const genesis = process.env.NAMES_GENESIS;

async function refName(name: string) {
  const res = await fetch(`${ref}/names/get/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  return (await res.json()).result ?? null;
}

const wallet = (keys: { genesis: string; username: string } | null) =>
  new LocalWallet({ url: node!, user: '', password: '', mode: 'local' }, keys ? { node: node!, password: '', ...keys } : null) as any;

describe.skipIf(!node || !ref)('name lookup without names/get', () => {
  it('finds a global name like names/get/name', async () => {
    const r = await wallet(null).lookupName('CARBON');
    const expected = await refName('CARBON');
    expect(expected?.register).toBeTruthy();
    expect(r?.register).toBe(expected.register);
    expect(r?.address).toBe(expected.address);
  }, 60000);

  it('says nothing for an unknown name', async () => {
    expect(await wallet(null).lookupName('NoSuchName-' + Date.now())).toBeNull();
  }, 60000);

  it.skipIf(!genesis)('finds the own local default name, also as user::default', async () => {
    const w = wallet({ genesis: genesis!, username: 'unknown-user' });
    const plain = await w.lookupName('default');
    expect(plain?.register).toMatch(/^8/);
    expect((await w.lookupName('user::default'))?.register).toBe(plain.register);
    const acct = await w.call('register/get/any', { address: plain.register });
    expect(acct.owner).toBe(genesis);
  }, 60000);

  it('a username that ends in user: is not read as the own namespace', async () => {
    const w = wallet({ genesis: genesis ?? 'a1'.padEnd(64, '0'), username: 'unknown-user' });
    expect(await w.lookupName('nosuchuser:default')).toBeNull();
  }, 120000);
});
