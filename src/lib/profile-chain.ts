//reading a profile from the chain alone, with nothing but a node's API: find it by username, check password and
//PIN, list the registers it owns. Plain functions over a `call`, shared by "sign in this browser" (local-wallet.ts)
//and other apps that sign locally (the Nexus DEX website).
import { cryptoRegisterAddress, deriveKey, genesisOf } from './keys';
import type { AccountState } from './tritium';

export type NodeCall = <T = any>(method: string, params?: Record<string, unknown>) => Promise<T>;

//genesis type byte of users per network (TAO/Ledger/include/enum.h GENESIS::*::USER): normal, hybrid, sister
const mainnetUserTypes = [0xa1, 0xa7, 0xab];
const testnetUserTypes = [0xb1, 0xb7, 0xbb];

//a token's own register holds the undistributed supply and can be sent from
export const accountTypes = new Set(['ACCOUNT', 'TRUST', 'TOKEN']);

export class ProfileError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export async function cryptoRegisterOf(call: NodeCall, genesis: string): Promise<{ owner: string; sign: string; auth: string } | null> {
  try {
    const r = await call<any>('register/get/crypto', { address: cryptoRegisterAddress(genesis) });
    return r ? { owner: r.owner, sign: r.sign, auth: r.auth } : null;
  } catch {
    return null;
  }
}

export async function findGenesis(call: NodeCall, username: string, testnet: boolean): Promise<{ genesis: string; auth: string }> {
  const base = (await genesisOf(username)).slice(2);
  for (const t of testnet ? testnetUserTypes : mainnetUserTypes) {
    const genesis = t.toString(16) + base;
    const reg = await cryptoRegisterOf(call, genesis);
    if (reg && reg.owner.toLowerCase() === genesis) {
      return { genesis, auth: reg.auth };
    }
  }
  throw new ProfileError(-130, 'No account with this username on this network');
}

//password and PIN are right when they make the auth key of the crypto register
export async function checkCredentials(username: string, password: string, pin: string, auth: string): Promise<void> {
  const k = await deriveKey(username, password, pin, 'auth');
  k.privateKey.fill(0);
  if (k.hash.toLowerCase() !== auth.toLowerCase()) {
    throw new ProfileError(-139, 'Username, password or PIN is not right');
  }
}

const nxsDecimals = 6;

//decimals of a token ('0' = NXS)
export async function tokenDecimals(call: NodeCall, token: string): Promise<number> {
  if (token === '0') {
    return nxsDecimals;
  }
  const t = await call<any>('register/get/any', { address: token });
  return Number(t.decimals ?? 0);
}

//an account register as signed transactions need it (pre-state). A token's own register holds the undistributed
//supply and serializes with supply and decimals (tokenInfo); a plain account without. The node prints amounts as
//decimals, so they are turned back into base units here.
export async function accountStateOf(
  call: NodeCall,
  address: string,
  decimalsOf: (token: string) => Promise<number> = (t) => tokenDecimals(call, t),
): Promise<{ state: AccountState; decimals: number; type: string }> {
  const a = await call<any>('register/get/any', { address });
  if (!accountTypes.has(a.type)) {
    throw new ProfileError(-65, 'Not an account');
  }
  const token = String(a.token ?? '0');
  const decimals = await decimalsOf(token);
  const units = (v: unknown) => BigInt(Math.round(Number(v) * 10 ** decimals));
  const tokenInfo = a.type === 'TOKEN' ? { supply: units(a.maxsupply), decimals } : undefined;
  return { state: { owner: a.owner, created: a.created, modified: a.modified, balance: units(a.balance), token, tokenInfo }, decimals, type: a.type };
}

export interface OwnRegister {
  address: string;
  type: string;
  name?: string;
}

export interface RegisterScan {
  scanned: number; //sigchain sequences read so far
  registers: OwnRegister[];
}

const pageSize = 100;

//registers the profile created or claimed, read along its sigchain; pass the last result to read only what is new
export async function scanOwnRegisters(call: NodeCall, genesis: string, from: RegisterScan = { scanned: 0, registers: [] }): Promise<RegisterScan> {
  let page = Math.floor(from.scanned / pageSize);
  let scanned = from.scanned;
  const registers = [...from.registers];
  for (;;) {
    const list = (await call<any[]>('ledger/list/transactions', { genesis, limit: pageSize, page, order: 'asc', verbose: 'summary' }).catch(() => [])) ?? [];
    for (const tx of list) {
      if (tx.sequence < from.scanned) {
        continue;
      }
      for (const c of tx.contracts ?? []) {
        if (c.OP === 'CREATE' && c.address && c.type && !registers.some((r) => r.address === c.address)) {
          registers.push({ address: c.address, type: c.type, name: c.name });
        }
        //a claimed register (an asset someone sent)
        if (c.OP === 'CLAIM' && c.address && !registers.some((r) => r.address === c.address)) {
          registers.push({ address: c.address, type: 'OBJECT' });
        }
      }
      scanned = Math.max(scanned, tx.sequence + 1);
    }
    if (list.length < pageSize) {
      break;
    }
    page += 1;
  }
  return { scanned, registers };
}
