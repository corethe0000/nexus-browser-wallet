//profile reading on a real node (private chain in nexus-dev, test profile alice):
//PROFILE_NODE=http://127.0.0.1:7080 PROFILE_USER=alice PROFILE_PASSWORD=alicepass1 PROFILE_PIN=1111 npx vitest run src/lib/profile-chain.int.test.ts
import { describe, expect, it } from 'vitest';
import { accountTypes, checkCredentials, findGenesis, ProfileError, scanOwnRegisters, type NodeCall } from './profile-chain';

const node = process.env.PROFILE_NODE;
const user = process.env.PROFILE_USER ?? '';
const password = process.env.PROFILE_PASSWORD ?? '';
const pin = process.env.PROFILE_PIN ?? '';

const call: NodeCall = async (method, params = {}) => {
  const res = await fetch(`${node}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const body = await res.json();
  if (body.error) {
    throw new Error(body.error.message);
  }
  return body.result;
};

describe.skipIf(!node)('profile reading on a node', () => {
  it('finds the profile, checks password and PIN, lists its accounts', async () => {
    const info = await call<any>('system/get/info');
    const { genesis, auth } = await findGenesis(call, user, !!info.testnet);
    expect(genesis).toMatch(/^[0-9a-f]{64}$/);
    await checkCredentials(user, password, pin, auth);
    const wrong = await checkCredentials(user, password, pin + '9', auth).then(
      () => null,
      (e) => e,
    );
    expect(wrong).toBeInstanceOf(ProfileError);
    expect((wrong as ProfileError).code).toBe(-139);

    const all = await scanOwnRegisters(call, genesis);
    expect(all.registers.some((r) => accountTypes.has(r.type))).toBe(true);
    //reading on from a result gives the same set
    const again = await scanOwnRegisters(call, genesis, all);
    expect(again.registers).toEqual(all.registers);
  }, 120000);

  it('an unknown username is an error with code -130', async () => {
    const e = await findGenesis(call, `nobody${Date.now()}`, true).then(
      () => null,
      (x) => x,
    );
    expect((e as ProfileError).code).toBe(-130);
  }, 60000);
});
