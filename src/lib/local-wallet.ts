//"sign in this browser": the same wallet calls without any login on the node. Reads use the no-login node API
//(ledger/list/transactions by genesis, register/get/any, ledger/get/transaction), payments to claim come from an
//index (explorer backend /explorer/incoming) or recent blocks, sends and claims are built and signed here
//(src/lib/tritium.ts) and submitted with ledger/submit/transaction
import { ErrorCodes, NexusError, type NodeSettings } from './node';
import { Wallet } from './wallet';
import { cryptoRegisterAddress, deriveKey, fromHex } from './keys';
import { accountStateOf, accountTypes, checkCredentials, findGenesis, ProfileError, scanOwnRegisters, type OwnRegister, type RegisterScan } from './profile-chain';
import { clearLocalKeys, loadLastSubmitted, saveLastSubmitted, saveLocalKeys, type LocalKeys } from './local-keys';
import { defaultExpiry, expirySeconds, isExpired } from './claims';
import { fillContracts, orderContract, orderTerms, type OrderTerms, invoiceContracts, invoiceData, invoicePayment, invoiceTerms, newInvoiceAddress, claimContract, stateAfter, transferContract, type RegisterState, accountContracts, addressOfMemory, assetContract, assetData, globalNameFee, nameContract, newAssetAddress, newTokenAddress, objectFee, tokenContract, tokenFee, feeContract, memoryOfAddress, nameFee, newAccountAddress, recoveryKey, credentialsContract, creditContract, debitContract, expiryCondition, nextHashOf, parseTx, sequenceKey, signTx, type AccountState, type CreditParams, type CryptoFields, type PrevTx } from './tritium';
import { formatAmount, isAddress } from './format';
import * as htlc from './htlc';
import type { SwapShown, SwapStep } from './swap-step';
import type { Account, Asset, Balance, Invoice, InvoiceItem, MarketOrder, Notification, SendRequest, Session, StakeInfo, Transaction } from './types';

const nxsDecimals = 6;
const pageSize = 100;
//TX_FEE_INTERVAL: a transaction this soon after the previous one pays a fee, the wallet waits instead
const feeIntervalSeconds = 10;
//without an index, payments to claim are looked for in this many newest blocks
const scanBlocks = 300;
//the newest blocks are read once for the payments and the registers of one refresh
const blockCacheMs = 15000;
let recentCache: { node: string; at: number; blocks: any[] } | null = null;
//blocks read one by one along previousblockhash, by node and hash; they do not change
const walkedBlocks = new Map<string, any>();
const maxWalkedBlocks = 1000;
const maxNotifications = 50;
const noRecovery = /^0*$/;

const notHere = (what: string) => new NexusError(ErrorCodes.NotSupported, `${what} is not available yet when signing in this browser`);

export class LocalWallet extends Wallet {
  private decimalsCache = new Map<string, number>();

  constructor(
    node: NodeSettings,
    private keys: LocalKeys | null,
    fetcher: typeof fetch = fetch,
  ) {
    super(node, fetcher);
  }

  private get indexUrl(): string | undefined {
    return this.node.index?.replace(/\/+$/, '') || undefined;
  }

  private need(): LocalKeys {
    if (!this.keys) {
      throw new NexusError(-11, 'Log in first');
    }
    return this.keys;
  }

  override async session(): Promise<Session | null> {
    return this.keys ? { genesis: this.keys.genesis, username: this.keys.username } : null;
  }

  //errors of the shared profile reading become wallet errors with the same code
  private async profileStep<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      throw e instanceof ProfileError ? new NexusError(e.code, e.message) : e;
    }
  }

  private async findGenesis(username: string): Promise<{ genesis: string; auth: string }> {
    const info = await this.info();
    return this.profileStep(() => findGenesis((m, p) => this.call(m, p), username, !!info.testnet));
  }

  private checkCredentials(username: string, password: string, pin: string, auth: string): Promise<void> {
    return this.profileStep(() => checkCredentials(username, password, pin, auth));
  }

  override async login(username: string, password: string, pin: string): Promise<Session & { session?: string }> {
    const name = username.trim();
    const { genesis, auth } = await this.findGenesis(name);
    await this.checkCredentials(name, password, pin, auth);
    this.keys = { node: this.node.url, username: name, password, genesis };
    await saveLocalKeys(this.keys);
    return { genesis, username: name };
  }

  override async validatePin(pin: string): Promise<boolean> {
    const k = this.need();
    const reg = await this.cryptoRegister(cryptoRegisterAddress(k.genesis));
    if (!reg) {
      return false;
    }
    try {
      await this.checkCredentials(k.username, k.password, pin, reg.auth);
      return true;
    } catch {
      return false;
    }
  }

  override async logout(pin: string): Promise<void> {
    if (!(await this.validatePin(pin))) {
      throw new NexusError(-139, 'Wrong PIN');
    }
    this.keys = null;
    await clearLocalKeys();
  }

  //--- own registers, from the profile's own chain (cached, only new transactions are read) ---

  private async ownRegisters(): Promise<OwnRegister[]> {
    const k = this.need();
    const cacheKey = `localRegisters:${k.genesis}`;
    const got = await browser.storage.local.get(cacheKey);
    const cache: RegisterScan = (got[cacheKey] as RegisterScan | undefined) ?? { scanned: 0, registers: [] };
    const { scanned, registers } = await scanOwnRegisters((m, p) => this.call(m, p), k.genesis, cache);
    if (scanned !== cache.scanned) {
      await browser.storage.local.set({ [cacheKey]: { scanned, registers } });
    }
    return registers;
  }

  private async decimalsOf(token: string): Promise<number> {
    if (token === '0') {
      return nxsDecimals;
    }
    if (!this.decimalsCache.has(token)) {
      const t = await this.call<any>('register/get/any', { address: token });
      this.decimalsCache.set(token, Number(t.decimals ?? 0));
    }
    return this.decimalsCache.get(token)!;
  }

  override async accounts(): Promise<Account[]> {
    const regs = (await this.ownRegisters()).filter((r) => accountTypes.has(r.type));
    const out = await Promise.all(
      regs.map(async (r) => {
        const a = await this.call<any>('register/get/any', { address: r.address }).catch(() => null);
        if (!a) {
          return null;
        }
        const token = String(a.token ?? '0');
        return { address: r.address, name: a.name ?? r.name, type: r.type, token, ticker: a.ticker ?? (token === '0' ? 'NXS' : undefined), balance: Number(a.balance ?? 0), stake: a.stake, created: a.created, modified: a.modified } as Account;
      }),
    );
    return out.filter((a): a is Account => !!a);
  }

  override async balances(): Promise<Balance[]> {
    const map = new Map<string, Balance>();
    for (const a of await this.accounts()) {
      const b = map.get(a.token) ?? { token: a.token, ticker: a.ticker, decimals: await this.decimalsOf(a.token), available: 0, confirmed: 0, unclaimed: 0, unconfirmed: 0, stake: 0 };
      if (a.type === 'TOKEN') {
        map.set(a.token, b);
        continue;
      }
      if (a.type === 'TRUST') {
        b.stake = (b.stake ?? 0) + Number((a as any).stake ?? 0);
      }
      b.available += a.balance;
      b.confirmed += a.balance;
      map.set(a.token, b);
    }
    if (!map.has('0')) {
      map.set('0', { token: '0', ticker: 'NXS', decimals: nxsDecimals, available: 0, confirmed: 0, unclaimed: 0, unconfirmed: 0, stake: 0 });
    }
    return [...map.values()];
  }

  //a public node does not know which accounts are ours, so "mine" is set here
  private markMine(contracts: any[], mine: Set<string>) {
    for (const c of contracts ?? []) {
      for (const side of ['from', 'to']) {
        const p = c[side];
        if (p && typeof p === 'object' && p.address) {
          p.mine = mine.has(p.address);
        }
      }
    }
  }

  override async transactions(limit: number, page: number): Promise<Transaction[]> {
    const k = this.need();
    const list = (await this.call<Transaction[]>('ledger/list/transactions', { genesis: k.genesis, limit, page, order: 'desc', verbose: 'summary' }).catch((e) => {
      //a profile without transactions answers -144
      if (e instanceof NexusError && e.code === -144) {
        return [];
      }
      throw e;
    })) ?? [];
    const mine = new Set((await this.ownRegisters()).map((r) => r.address));
    list.forEach((t) => this.markMine(t.contracts, mine));
    return list;
  }

  //--- payments to claim ---

  //the index's payments to these accounts and registers sent to this profile; transfers false = an index
  //without recipients (older backend or still filling them), registers then come from the blocks
  private async fromIndex(accounts: string[]): Promise<{ rows: { op: string; txid: string; idx: number }[]; transfers: boolean }> {
    const q = [...accounts.map((a) => `addr=${encodeURIComponent(a)}`), `genesis=${this.need().genesis}`].join('&');
    const res = await fetch(`${this.indexUrl}/explorer/incoming?${q}&limit=${maxNotifications}`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body?.result)) {
      throw new NexusError(-1, body?.error?.message ?? `The index answered ${res.status}`);
    }
    return { rows: body.result.map((r: any) => ({ op: r.op ?? 'DEBIT', txid: r.txid, idx: Number(r.idx) })), transfers: body.transfers === true };
  }

  private async candidateDebits(accounts: Set<string>): Promise<{ txid: string; contract: number }[]> {
    const out: { txid: string; contract: number }[] = [];
    if (this.indexUrl) {
      const { rows, transfers } = await this.fromIndex([...accounts]);
      for (const r of rows) {
        out.push({ txid: r.txid, contract: r.idx });
      }
      if (!transfers) {
        for (const t of await this.incomingTransfers(true)) {
          out.push({ txid: t.txid, contract: t.id });
        }
      }
      return out;
    }
    for (const b of await this.recentBlocks()) {
      for (const tx of b.tx ?? []) {
        for (const c of tx.contracts ?? []) {
          if (c.OP === 'DEBIT' && accounts.has(c.to?.address ?? c.to)) {
            out.push({ txid: tx.txid, contract: c.id });
          }
          if (c.OP === 'TRANSFER' && String(c.recipient ?? '').toLowerCase() === this.keys?.genesis) {
            out.push({ txid: tx.txid, contract: c.id });
          }
        }
      }
    }
    return out;
  }

  //the newest scanBlocks blocks, newest first; a node started without -indexheight ignores page (every
  //page is the newest one), older blocks then come one by one along previousblockhash
  private async recentBlocks(): Promise<any[]> {
    if (recentCache?.node === this.node.url && Date.now() - recentCache.at < blockCacheMs) {
      return recentCache.blocks;
    }
    const out: any[] = [];
    const heights = new Set<number>();
    for (let page = 0; out.length < scanBlocks; page++) {
      const blocks = (await this.call<any[]>('ledger/list/blocks', { limit: pageSize, page, verbose: 'detail' }).catch(() => [])) ?? [];
      const fresh = blocks.filter((b) => !heights.has(b.height));
      for (const b of fresh) {
        heights.add(b.height);
        out.push(b);
      }
      if (blocks.length < pageSize) {
        break;
      }
      if (fresh.length === 0) {
        let b = out[out.length - 1];
        while (out.length < scanBlocks && b?.previousblockhash && b.height > 1) {
          const key = `${this.node.url}|${b.previousblockhash}`;
          b = walkedBlocks.get(key) ?? (await this.call<any>('ledger/get/block', { hash: b.previousblockhash, verbose: 'detail' }).catch(() => null));
          if (!b) {
            break;
          }
          walkedBlocks.set(key, b);
          out.push(b);
        }
        break;
      }
    }
    while (walkedBlocks.size > maxWalkedBlocks) {
      walkedBlocks.delete(walkedBlocks.keys().next().value!);
    }
    recentCache = { node: this.node.url, at: Date.now(), blocks: out };
    return out;
  }

  override async notifications(): Promise<Notification[]> {
    const accounts = new Set((await this.accounts()).map((a) => a.address));
    if (!accounts.size) {
      return [];
    }
    const seen = new Set<string>();
    const out: Notification[] = [];
    for (const d of await this.candidateDebits(accounts)) {
      if (seen.has(d.txid) || out.length >= maxNotifications) {
        continue;
      }
      seen.add(d.txid);
      const tx = await this.call<Transaction>('ledger/get/transaction', { hash: d.txid, verbose: 'summary' }).catch(() => null);
      for (const c of tx?.contracts ?? []) {
        const to = typeof c.to === 'object' ? c.to?.address : c.to;
        if (c.OP === 'DEBIT' && to && accounts.has(to) && Number(c.claimed ?? 0) < Number(c.amount ?? 0)) {
          out.push({ ...c, txid: tx!.txid, timestamp: tx!.timestamp } as Notification);
        }
        //an asset still in transfer to us: its owner has the system type 00 in front; invoices have their own tab
        if (c.OP === 'TRANSFER' && (c as any).form !== 'INVOICE' && String((c as any).recipient ?? '').toLowerCase() === this.keys?.genesis && (await this.inTransfer(c.address!))) {
          out.push({ ...c, txid: tx!.txid, timestamp: tx!.timestamp } as Notification);
        }
      }
    }
    return out;
  }

  //registers sent to this profile (index, else the newest blocks); all = also the ones claimed or taken back since
  private async incomingTransfers(all = false): Promise<(Notification & { address?: string; form?: string })[]> {
    const k = this.need();
    const out: (Notification & { address?: string; form?: string })[] = [];
    const indexed = this.indexUrl ? await this.fromIndex([]).catch(() => null) : null;
    if (indexed?.transfers) {
      for (const txid of new Set(indexed.rows.filter((r) => r.op === 'TRANSFER').map((r) => r.txid))) {
        const tx = await this.call<any>('ledger/get/transaction', { hash: txid, verbose: 'summary' }).catch(() => null);
        for (const c of tx?.contracts ?? []) {
          if (c.OP === 'TRANSFER' && String(c.recipient ?? '').toLowerCase() === k.genesis && (all || (await this.inTransfer(c.address)))) {
            out.push({ ...c, txid: tx.txid, timestamp: tx.timestamp });
          }
        }
      }
      return out;
    }
    for (const b of await this.recentBlocks()) {
      for (const tx of b.tx ?? []) {
        for (const c of tx.contracts ?? []) {
          if (c.OP === 'TRANSFER' && String(c.recipient ?? '').toLowerCase() === k.genesis && (all || (await this.inTransfer(c.address)))) {
            out.push({ ...c, txid: tx.txid, timestamp: tx.timestamp });
          }
        }
      }
    }
    return out;
  }

  private async inTransfer(address: string): Promise<boolean> {
    const r = await this.call<any>('register/get/any', { address }).catch(() => null);
    return !!r && String(r.owner).startsWith('00');
  }

  //the register's state now, from the newest of its transactions in this profile's chain
  private async ownRegisterState(address: string): Promise<RegisterState> {
    const k = this.need();
    const list = (await this.call<any[]>('ledger/list/transactions', { genesis: k.genesis, limit: pageSize, order: 'desc', verbose: 'summary' })) ?? [];
    for (const tx of list) {
      if ((tx.contracts ?? []).some((c: any) => c.address === address && ['CREATE', 'CLAIM'].includes(c.OP))) {
        const raw = await this.call<{ data: string }>('ledger/get/transaction', { hash: tx.txid, format: 'raw' });
        return stateAfter(raw.data, memoryOfAddress(address));
      }
      if ((tx.contracts ?? []).some((c: any) => c.address === address)) {
        throw new NexusError(ErrorCodes.NotSupported, 'This asset was changed after it came here, sending it is not supported yet');
      }
    }
    throw new NexusError(-13, 'Could not find where this asset came from in your newest 100 transactions');
  }

  //--- transactions signed here ---

  private async accountState(address: string): Promise<{ state: AccountState; decimals: number }> {
    const { state, decimals } = await this.profileStep(() =>
      accountStateOf(
        (m, p) => this.call(m, p),
        address,
        (t) => this.decimalsOf(t),
      ),
    );
    return { state, decimals };
  }

  //newest transaction of the chain; a transaction this wallet sent must be in a block before the next one,
  //the account states read from the node are the confirmed ones
  private async chainHead(genesis: string): Promise<PrevTx & { nexthash: string }> {
    const last = await loadLastSubmitted(genesis);
    if (last) {
      const t = await this.call<any>('ledger/get/transaction', { hash: last.txid }).catch(() => null);
      if (!t || !(t.confirmations > 0)) {
        throw new NexusError(-1040, 'The previous transaction waits for the next block, try again in a minute');
      }
      await saveLastSubmitted(null);
    }
    const [head] = await this.call<{ txid: string }[]>('ledger/list/transactions', { genesis, limit: 1, order: 'desc' });
    const raw = await this.call<{ data: string }>('ledger/get/transaction', { hash: head!.txid, format: 'raw' });
    const h = parseTx(raw.data);
    return { txid: head!.txid, sequence: h.sequence, timestamp: h.timestamp, genesis, recovery: h.recovery, nexthash: h.nexthash };
  }

  //next = other credentials for the keys from the next transaction on (password or PIN change)
  //who = a profile that is not logged in (recover), signKey = sign with the recovery key, recovery = new recovery hash
  private async signAndSubmit(
    pin: string,
    contracts: (ts: number) => Uint8Array[],
    next?: { password: string; pin: string },
    opts: { who?: { username: string; password: string; genesis: string }; signKey?: { privateKey: Uint8Array; publicKey: Uint8Array }; recovery?: string } = {},
  ): Promise<string> {
    const k = opts.who ?? this.need();
    const head = await this.chainHead(k.genesis);
    const prev = opts.recovery ? { ...head, recovery: opts.recovery } : head;
    const key = opts.signKey ?? (await sequenceKey(k.username, k.password, pin, prev.sequence + 1));
    //the previous transaction named the hash of this key: a wrong PIN gives another one
    if (!opts.signKey && nextHashOf(key.publicKey) !== prev.nexthash) {
      key.privateKey.fill(0);
      throw new NexusError(-139, 'Wrong PIN');
    }
    const nextKey = await sequenceKey(k.username, next?.password ?? k.password, next?.pin ?? pin, prev.sequence + 2);
    nextKey.privateKey.fill(0);
    const wait = prev.timestamp + feeIntervalSeconds + 1 - Math.floor(Date.now() / 1000);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    try {
      const signed = signTx(prev, contracts, Math.max(Math.floor(Date.now() / 1000), prev.timestamp), key, nextKey);
      const r = await this.call<{ hash?: string }>('ledger/submit/transaction', { data: signed.data });
      if (r?.hash !== signed.txid) {
        throw new NexusError(-150, 'The node did not take the transaction');
      }
      await saveLastSubmitted({ genesis: k.genesis, txid: signed.txid });
      return signed.txid;
    } finally {
      key.privateKey.fill(0);
    }
  }

  private async resolveAccount(to: string): Promise<string> {
    const t = to.trim();
    if (isAddress(t)) {
      return t;
    }
    const n = await this.call<any>('names/get/name', { name: t }).catch(() => null);
    if (!n?.register) {
      throw new NexusError(-13, `No account named ${t}`);
    }
    return n.register;
  }

  override async send(req: SendRequest): Promise<string> {
    const k = this.need();
    const from = await this.accountState(req.from);
    const to = await this.resolveAccount(req.to);
    const target = await this.call<any>('register/get/any', { address: to });
    if (target.type !== 'ACCOUNT' && target.type !== 'TRUST') {
      throw new NexusError(-65, 'The receiver is not an account');
    }
    if (String(target.token ?? '0') !== from.state.token) {
      throw new NexusError(-66, 'The receiving account holds another token');
    }
    const amount = BigInt(Math.round(req.amount * 10 ** from.decimals));
    if (amount <= 0n || amount > from.state.balance) {
      throw new NexusError(-69, 'Insufficient funds');
    }
    const reference = BigInt(req.reference || 0);
    //like the core: no expiry on a send to an own account, the condition would stop this chain from claiming it
    const toSelf = String(target.owner).toLowerCase() === k.genesis.toLowerCase();
    const condition = toSelf ? undefined : expiryCondition(k.genesis, req.expires ?? defaultExpiry);
    return this.signAndSubmit(req.pin, (ts) => [debitContract({ from: { address: req.from, state: from.state }, to, amount, reference, condition }, ts)]);
  }

  //every open debit of these transactions to our accounts in one transaction, each credit on the state the last one left
  async claimAll(txids: string[], pin: string): Promise<string> {
    const mine = new Set((await this.accounts()).map((a) => a.address));
    const claims: CreditParams[] = [];
    const states = new Map<string, AccountState>();
    for (const txid of txids) {
      const tx = await this.call<Transaction>('ledger/get/transaction', { hash: txid, verbose: 'summary' });
      for (const c of tx.contracts ?? []) {
        const to = typeof c.to === 'object' ? c.to?.address : c.to;
        const from = typeof c.from === 'object' ? c.from?.address : c.from;
        if (c.OP !== 'DEBIT' || !to || !from || !mine.has(to) || isExpired(c, tx.timestamp)) {
          continue;
        }
        if (!states.has(to)) {
          states.set(to, (await this.accountState(to)).state);
        }
        const decimals = await this.decimalsOf(String(c.token ?? '0'));
        const open = BigInt(Math.round((Number(c.amount ?? 0) - Number(c.claimed ?? 0)) * 10 ** decimals));
        if (open > 0n) {
          claims.push({ debitTxid: txid, contract: c.id, to: { address: to, state: states.get(to)! }, from, amount: open });
        }
      }
    }
    const assets = await this.assetClaims(txids);
    if (!claims.length && !assets.length) {
      throw new NexusError(-44, 'Nothing to claim');
    }
    return this.submitCredits(claims, states, pin, assets);
  }

  //asset transfers to this profile in these transactions, with the state each one left
  private async assetClaims(txids: string[]): Promise<{ txid: string; contract: number; address: Uint8Array; state: RegisterState }[]> {
    const k = this.need();
    const out: { txid: string; contract: number; address: Uint8Array; state: RegisterState }[] = [];
    for (const txid of txids) {
      const tx = await this.call<Transaction>('ledger/get/transaction', { hash: txid, verbose: 'summary' });
      const mine = (tx.contracts ?? []).filter((c: any) => c.OP === 'TRANSFER' && String(c.recipient ?? '').toLowerCase() === k.genesis && !isExpired(c, tx.timestamp));
      if (!mine.length) {
        continue;
      }
      const raw = await this.call<{ data: string }>('ledger/get/transaction', { hash: txid, format: 'raw' });
      for (const c of mine) {
        if (await this.inTransfer(c.address!)) {
          const address = memoryOfAddress(c.address!);
          out.push({ txid, contract: c.id, address, state: stateAfter(raw.data, address) });
        }
      }
    }
    return out;
  }

  private submitCredits(claims: CreditParams[], states: Map<string, AccountState>, pin: string, assets: { txid: string; contract: number; address: Uint8Array; state: RegisterState }[] = []): Promise<string> {
    const k = this.need();
    return this.signAndSubmit(pin, (ts) => {
      const now = new Map(states);
      const credits = claims.map((c) => {
        const state = now.get(c.to.address)!;
        now.set(c.to.address, { ...state, balance: state.balance + c.amount, modified: ts });
        return creditContract({ ...c, to: { address: c.to.address, state } }, ts);
      });
      return [...credits, ...assets.map((a) => claimContract(k.genesis, a.txid, a.contract, a.address, a.state, ts))];
    });
  }

  //API/conditions.cpp AddVoid: a credit of what is still unclaimed, from the sending account back to itself
  override async voidTx(txid: string, pin: string): Promise<string> {
    const k = this.need();
    const tx = await this.call<Transaction & { genesis?: string }>('ledger/get/transaction', { hash: txid, verbose: 'detail' });
    if (tx.genesis?.toLowerCase() !== k.genesis.toLowerCase()) {
      throw new NexusError(-43, 'This transaction is not yours');
    }
    const claims: CreditParams[] = [];
    const states = new Map<string, AccountState>();
    for (const c of tx.contracts ?? []) {
      const from = typeof c.from === 'object' ? c.from?.address : c.from;
      if (c.OP !== 'DEBIT' || !from) {
        continue;
      }
      //the tx timestamp must be past the expiry, a second of margin for rounding
      if (c.conditions && (expirySeconds(c) === null || !isExpired(c, tx.timestamp, Date.now() - 1000))) {
        throw new NexusError(-43, 'This payment cannot be taken back now');
      }
      if (!states.has(from)) {
        states.set(from, (await this.accountState(from)).state);
      }
      const decimals = await this.decimalsOf(String(c.token ?? '0'));
      const open = BigInt(Math.round((Number(c.amount ?? 0) - Number(c.claimed ?? 0)) * 10 ** decimals));
      if (open > 0n) {
        claims.push({ debitTxid: txid, contract: c.id, to: { address: from, state: states.get(from)! }, from, amount: open });
      }
    }
    if (!claims.length) {
      throw new NexusError(-173, 'Nothing left to take back');
    }
    return this.submitCredits(claims, states, pin);
  }

  override async claim(txid: string, pin: string): Promise<string> {
    return this.claimAll([txid], pin);
  }

  //--- swap steps for the Nexus DEX (nexus_swapStep) ---

  override async swapPreview(step: SwapStep): Promise<SwapShown> {
    return (await this.swapPlan(step)).shown;
  }

  //planned again from the chain when signing, the window only showed the preview
  override async swapStep(step: SwapStep, pin: string): Promise<string> {
    const plan = await this.swapPlan(step);
    return this.signAndSubmit(pin, plan.contracts);
  }

  private async slotOf(genesis: string): Promise<htlc.SlotState | null> {
    const r = await this.call<any>('register/get/any', { address: addressOfMemory(htlc.slotAddress(genesis)) }).catch(() => null);
    return r ? htlc.parseSlot(r) : null;
  }

  private async lockDebit(txid: string, contract: number): Promise<{ tx: Transaction & { genesis?: string }; c: Transaction['contracts'][number]; from: string; to: string; open: bigint; decimals: number }> {
    const tx = await this.call<Transaction & { genesis?: string }>('ledger/get/transaction', { hash: txid, verbose: 'detail' }).catch(() => null);
    const c = tx?.contracts?.find((x) => x.id === contract);
    const from = typeof c?.from === 'object' ? c.from?.address : c?.from;
    const to = typeof c?.to === 'object' ? c.to?.address : c?.to;
    if (!tx || !c || c.OP !== 'DEBIT' || !from || !to || !c.conditions) {
      throw new NexusError(-43, 'This is not a swap lock');
    }
    const decimals = await this.decimalsOf(String(c.token ?? '0'));
    const open = BigInt(Math.round((Number(c.amount ?? 0) - Number(c.claimed ?? 0)) * 10 ** decimals));
    if (open <= 0n) {
      throw new NexusError(-173, 'This lock was already taken');
    }
    return { tx, c, from, to, open, decimals };
  }

  private async swapPlan(step: SwapStep): Promise<{ shown: SwapShown; contracts: (ts: number) => Uint8Array[] }> {
    const k = this.need();
    const mine = new Map((await this.accounts()).map((a) => [a.address, a]));
    const shownAmount = (v: bigint, decimals: number) => formatAmount(Number(v) / 10 ** decimals, decimals);
    switch (step.step) {
      case 'setup': {
        if (await this.slotOf(k.genesis)) {
          throw new NexusError(-97, 'Swaps are already set up for this profile');
        }
        const fee = await this.feeOnNetwork(htlc.slotFee);
        const pay = await this.feePayer(fee);
        return { shown: fee > 0n ? { fee: formatAmount(Number(fee) / 1e6) } : {}, contracts: (ts) => [...htlc.slotCreateContracts(k.genesis, ts), ...pay(ts)] };
      }
      case 'lock': {
        const own = mine.get(step.from);
        if (!own) {
          throw new NexusError(-43, 'The lock must come from one of your accounts');
        }
        const from = await this.accountState(step.from);
        const target = await this.call<any>('register/get/any', { address: step.to }).catch(() => null);
        if (!target || (target.type !== 'ACCOUNT' && target.type !== 'TRUST') || String(target.token ?? '0') !== from.state.token) {
          throw new NexusError(-66, 'The receiving account does not hold this token');
        }
        if (String(target.owner).toLowerCase() !== step.recipient) {
          throw new NexusError(-66, 'The receiving account belongs to someone else than the recipient of the lock');
        }
        //no short circuit in conditions: without the recipient's slot even the refund path would fail
        if (!(await this.slotOf(step.recipient))) {
          throw new NexusError(-66, 'The other side has not set up swaps, the lock could not be taken back');
        }
        const amount = BigInt(step.amount);
        if (amount > from.state.balance) {
          throw new NexusError(-69, 'Insufficient funds');
        }
        const terms: htlc.NexusLockTerms = { recipient: step.recipient, sender: k.genesis, hashlock: fromHex(step.hashlock), deadline: step.deadline };
        return {
          shown: { amount: shownAmount(amount, from.decimals), ticker: own.ticker ?? (from.state.token === '0' ? 'NXS' : ''), account: own.name ?? step.from, counter: step.to, deadline: step.deadline },
          contracts: (ts) => [htlc.lockContract({ address: step.from, state: from.state }, step.to, amount, terms, ts)],
        };
      }
      case 'reveal': {
        const slot = await this.slotOf(k.genesis);
        if (!slot) {
          throw new NexusError(-43, 'Swaps are not set up for this profile');
        }
        const secret = fromHex(step.secret);
        return { shown: {}, contracts: (ts) => [htlc.revealContract(k.genesis, slot, secret, ts)] };
      }
      case 'claim': {
        const d = await this.lockDebit(step.txid, step.contract);
        const own = mine.get(d.to);
        if (!own) {
          throw new NexusError(-43, 'This lock is not for one of your accounts');
        }
        const to = await this.accountState(d.to);
        return {
          shown: { amount: shownAmount(d.open, d.decimals), ticker: own.ticker ?? d.c.ticker, account: own.name ?? d.to, counter: d.from },
          contracts: (ts) => [htlc.claimContract(step.txid, step.contract, { address: d.to, state: to.state }, d.from, d.open, ts)],
        };
      }
      case 'refund': {
        const d = await this.lockDebit(step.txid, step.contract);
        const own = mine.get(d.from);
        if (d.tx.genesis?.toLowerCase() !== k.genesis.toLowerCase() || !own) {
          throw new NexusError(-43, 'This lock is not yours');
        }
        const from = await this.accountState(d.from);
        return {
          shown: { amount: shownAmount(d.open, d.decimals), ticker: own.ticker ?? d.c.ticker, account: own.name ?? d.from },
          contracts: (ts) => [htlc.refundContract(step.txid, step.contract, { address: d.from, state: from.state }, d.open, ts)],
        };
      }
    }
  }

  //--- not built for this mode yet ---

  override async stakeInfo(): Promise<StakeInfo | null> {
    return null;
  }

  //assets this profile made; ones received from others come with claiming assets
  override async assets(): Promise<Asset[]> {
    const k = this.need();
    const regs = (await this.ownRegisters()).filter((r) => r.type === 'OBJECT');
    const out = await Promise.all(regs.map((r) => this.call<any>('register/get/any', { address: r.address }).catch(() => null)));
    return out.filter((x) => x && x.owner === k.genesis && x.form === 'ASSET') as Asset[];
  }

  //open invoices to this profile (block scan) and the ones it sent that nobody paid yet (own chain)
  override async invoices(): Promise<Invoice[]> {
    const k = this.need();
    const hidden = await this.rejected();
    const addresses = new Set<string>();
    for (const r of await this.ownRegisters()) {
      if (r.type === 'READONLY') {
        addresses.add(r.address);
      }
    }
    for (const n of await this.incomingTransfers()) {
      if (n.form === 'INVOICE' && !hidden.has(n.address!)) {
        addresses.add(n.address!);
      }
    }
    const out: Invoice[] = [];
    for (const a of addresses) {
      const inv = await this.invoice(a).catch(() => null);
      if (inv && inv.status === 'OUTSTANDING' && (inv.recipient === k.genesis || inv.issuer.slice(2) === k.genesis.slice(2))) {
        out.push(inv);
      }
    }
    return out;
  }

  private async rejected(): Promise<Set<string>> {
    const key = `rejectedInvoices:${this.need().genesis}`;
    const got = await browser.storage.local.get(key);
    return new Set((got[key] as string[] | undefined) ?? []);
  }

  //the core's reject only stops showing the invoice to the payer, it stays open for the issuer
  override async rejectInvoice(address: string): Promise<string> {
    const key = `rejectedInvoices:${this.need().genesis}`;
    const list = await this.rejected();
    list.add(address);
    await browser.storage.local.set({ [key]: [...list] });
    return '';
  }

  //the transaction that made and sent an invoice, from the payer's view: the TRANSFER of it
  private async invoiceOrigin(address: string): Promise<{ txid: string; raw: string }> {
    for (const n of await this.incomingTransfers(true)) {
      if (n.address === address) {
        const raw = await this.call<{ data: string }>('ledger/get/transaction', { hash: n.txid, format: 'raw' });
        return { txid: n.txid, raw: raw.data };
      }
    }
    //sent by this profile: its own chain
    const k = this.need();
    const list = (await this.call<any[]>('ledger/list/transactions', { genesis: k.genesis, limit: pageSize, order: 'desc', verbose: 'summary' })) ?? [];
    const tx = list.find((x) => (x.contracts ?? []).some((c: any) => c.OP === 'TRANSFER' && c.address === address));
    if (!tx) {
      throw new NexusError(-247, 'Could not find the transaction of this invoice');
    }
    const raw = await this.call<{ data: string }>('ledger/get/transaction', { hash: tx.txid, format: 'raw' });
    return { txid: tx.txid, raw: raw.data };
  }

  override async payInvoice(address: string, from: string, pin: string): Promise<string> {
    const k = this.need();
    const inv = await this.invoice(address);
    if (inv.status !== 'OUTSTANDING' || inv.recipient !== k.genesis) {
      throw new NexusError(-245, 'This invoice is not open for you');
    }
    const origin = await this.invoiceOrigin(address);
    const addr = memoryOfAddress(address);
    const terms = invoiceTerms(origin.raw, addr);
    const state = stateAfter(origin.raw, addr);
    const source = await this.accountState(from);
    if (source.state.token !== inv.token) {
      throw new NexusError(-252, 'This account holds another token than the invoice asks');
    }
    return this.signAndSubmit(pin, (ts) => invoicePayment(k.genesis, origin.txid, terms.contract, addr, state, { address: from, state: source.state }, terms.account, terms.total, ts));
  }

  //the issuer takes the invoice back: a claim of its own transfer
  override async cancelInvoice(address: string, pin: string): Promise<string> {
    const k = this.need();
    const inv = await this.invoice(address);
    if (inv.status !== 'OUTSTANDING') {
      throw new NexusError(-245, 'This invoice is not open any more');
    }
    const origin = await this.invoiceOrigin(address);
    const addr = memoryOfAddress(address);
    const terms = invoiceTerms(origin.raw, addr);
    const state = stateAfter(origin.raw, addr);
    return this.signAndSubmit(pin, (ts) => [claimContract(k.genesis, origin.txid, terms.contract, addr, state, ts)]);
  }

  override async createInvoice(inv: { to: string; recipient: string; items: InvoiceItem[]; reference?: string; pin: string }): Promise<{ txid: string; address: string }> {
    const k = this.need();
    const payer = /^[0-9a-f]{64}$/i.test(inv.recipient.trim()) ? inv.recipient.trim().toLowerCase() : (await this.findGenesis(inv.recipient.trim())).genesis;
    const account = await this.call<any>('register/get/any', { address: inv.to });
    if (account.type !== 'ACCOUNT') {
      throw new NexusError(-65, 'Invoices are paid into an account');
    }
    const token = String(account.token ?? '0');
    const decimals = await this.decimalsOf(token);
    const units = (v: number) => BigInt(Math.round(v * 10 ** decimals));
    const total = inv.items.reduce((s, i) => s + units(i.amount) * BigInt(i.units), 0n);
    //the json fields in the order the core writes them
    const json: Record<string, unknown> = { account: inv.to, recipient: payer, items: inv.items.map((i) => ({ amount: i.amount, units: i.units, ...(i.description ? { description: i.description } : {}) })), to: inv.to };
    if (inv.reference) {
      json.reference = inv.reference;
    }
    json.amount = Number(total) / 10 ** decimals;
    json.token = token;
    const data = invoiceData(JSON.stringify(json));
    const pay = await this.feePayer(await this.feeOnNetwork(objectFee(data.length)));
    const address = newInvoiceAddress();
    const tokenMem = token === '0' ? new Uint8Array(32) : memoryOfAddress(token);
    const txid = await this.signAndSubmit(inv.pin, (ts) => [...invoiceContracts(k.genesis, address, data, payer, memoryOfAddress(inv.to), tokenMem, total, ts), ...pay(ts)]);
    return { txid, address: addressOfMemory(address) };
  }

  //the market list shows every order of the pair, ours are the ones we made
  override async myOrders(tokens: string[]): Promise<MarketOrder[]> {
    const k = this.need();
    if (tokens.length < 2) {
      return [];
    }
    const { bids, asks } = await this.marketOrders(`${tokens[0]}/${tokens[1]}`);
    return [...bids, ...asks].filter((o) => String(o.owner).toLowerCase() === k.genesis).sort((a, b) => b.timestamp - a.timestamp);
  }

  override async createProfile(): Promise<string> {
    throw notHere('Creating a profile');
  }

  //signed with the current key; the next key and the crypto register's key hashes come from the new credentials
  override async updateCredentials(pin: string, newPassword: string | undefined, newPin: string | undefined): Promise<string> {
    const k = this.need();
    const password = newPassword || k.password;
    const nextPin = newPin || pin;
    if (password === k.password && nextPin === pin) {
      throw new NexusError(-233, 'Enter a new password or a new PIN');
    }
    const contracts = await this.cryptoWrite(k.username, k.genesis, password, nextPin);
    const txid = await this.signAndSubmit(pin, contracts, { password, pin: nextPin });
    this.keys = { ...k, password };
    await saveLocalKeys(this.keys);
    return txid;
  }

  //like BuildCrypto: auth always, the other keys only when enabled, made from these credentials
  private async cryptoWrite(username: string, genesis: string, password: string, pin: string): Promise<(ts: number) => Uint8Array[]> {
    const reg = await this.call<any>('register/get/crypto', { address: cryptoRegisterAddress(genesis) });
    const zero = /^0+$/;
    const updates: CryptoFields = {};
    for (const name of ['auth', 'lisp', 'network', 'sign', 'verify'] as const) {
      if (name === 'auth' || !zero.test(String(reg[name]))) {
        const d = await deriveKey(username, password, pin, name);
        d.privateKey.fill(0);
        updates[name] = d.hash;
      }
    }
    const { auth, lisp, network, sign, verify, cert, app1, app2, app3 } = reg;
    return (ts) => [credentialsContract(genesis, { created: reg.created, modified: reg.modified, fields: { auth, lisp, network, sign, verify, cert, app1, app2, app3 } }, updates, ts)];
  }

  //the key of a phrase, refused unless it is the one the chain has on record
  private async checkedRecoveryKey(phrase: string, genesis: string, onChain: string) {
    const key = await recoveryKey(phrase, parseInt(genesis.slice(0, 2), 16));
    if (nextHashOf(key.publicKey) !== onChain) {
      key.privateKey.fill(0);
      throw new NexusError(-33, 'The recovery phrase is not right');
    }
    return key;
  }

  //a first phrase is signed with the normal key, changing one with the key of the old phrase
  override async updateRecovery(pin: string, newRecovery: string, recovery: string | undefined): Promise<string> {
    const k = this.need();
    //the key of the old phrase signs without the PIN, and a wrong PIN here would lock the chain
    if (!(await this.validatePin(pin))) {
      throw new NexusError(-139, 'Wrong PIN');
    }
    const head = await this.chainHead(k.genesis);
    const hasPhrase = !noRecovery.test(head.recovery ?? '');
    if (hasPhrase && !recovery) {
      throw new NexusError(-233, 'Enter the current recovery phrase');
    }
    const signKey = hasPhrase ? await this.checkedRecoveryKey(recovery!, k.genesis, head.recovery!) : undefined;
    const fresh = await recoveryKey(newRecovery, parseInt(k.genesis.slice(0, 2), 16));
    fresh.privateKey.fill(0);
    const contracts = await this.cryptoWrite(k.username, k.genesis, k.password, pin);
    return this.signAndSubmit(pin, contracts, undefined, { signKey, recovery: nextHashOf(fresh.publicKey) });
  }

  //new password and PIN with the phrase, nobody is logged in
  override async recoverProfile(username: string, recovery: string, password: string, pin: string): Promise<string> {
    const name = username.trim();
    const { genesis } = await this.findGenesis(name);
    const head = await this.chainHead(genesis);
    if (noRecovery.test(head.recovery ?? '')) {
      throw new NexusError(-223, 'This account has no recovery phrase');
    }
    const signKey = await this.checkedRecoveryKey(recovery, genesis, head.recovery!);
    const contracts = await this.cryptoWrite(name, genesis, password, pin);
    return this.signAndSubmit(pin, contracts, { password, pin }, { who: { username: name, password, genesis }, signKey });
  }

  override async claimAsset(txid: string, pin: string): Promise<string> {
    return this.claimAll([txid], pin);
  }

  //recipient = username or genesis; the receiver claims it, after the expiry the sender can take it back
  override async transferAsset(address: string, recipient: string, pin: string): Promise<string> {
    const k = this.need();
    const to = /^[0-9a-f]{64}$/i.test(recipient.trim()) ? recipient.trim().toLowerCase() : (await this.findGenesis(recipient.trim())).genesis;
    if (to === k.genesis) {
      throw new NexusError(-1042, 'This asset is yours already');
    }
    const state = await this.ownRegisterState(address);
    return this.signAndSubmit(pin, (ts) => [transferContract(k.genesis, memoryOfAddress(address), to, state, expiryCondition(k.genesis, defaultExpiry), ts)]);
  }

  //ask = sell the first token for the second (amount in the first, price = second per first);
  //bid = buy the first token with the second (amount = what is paid in the second)
  override async createOrder(o: { type: 'bid' | 'ask'; market: string; amount: number; price: number; from: string; to: string; pin: string }): Promise<string> {
    const from = await this.accountState(o.from);
    const to = await this.call<any>('register/get/any', { address: o.to });
    if (!accountTypes.has(to.type)) {
      throw new NexusError(-65, 'The receiving account is not an account');
    }
    const toToken = String(to.token ?? '0');
    if (toToken === from.state.token) {
      throw new NexusError(-26, 'An order trades two different tokens');
    }
    const toDecimals = await this.decimalsOf(toToken);
    const units = (v: number, d: number) => BigInt(Math.round(v * 10 ** d));
    const amount = units(o.amount, from.decimals);
    //price is counted in the second token of the pair: the one paid (ask: received, bid: paid)
    const ask = o.type === 'ask' ? (amount * units(o.price, toDecimals)) / 10n ** BigInt(from.decimals) : (amount * 10n ** BigInt(toDecimals)) / units(o.price, from.decimals);
    if (amount <= 0n || ask <= 0n) {
      throw new NexusError(-7, 'Order total value is zero');
    }
    const askToken = toToken === '0' ? new Uint8Array(32) : memoryOfAddress(toToken);
    return this.signAndSubmit(o.pin, (ts) => [orderContract({ address: o.from, state: from.state }, amount, memoryOfAddress(o.to), ask, askToken, ts)]);
  }

  private async orderOf(txid: string): Promise<OrderTerms> {
    const raw = await this.call<{ data: string }>('ledger/get/transaction', { hash: txid, format: 'raw' });
    return orderTerms(raw.data);
  }

  //from = own account in the token the order asks, to = own account in the token it gives
  override async executeOrder(txid: string, from: string, to: string, pin: string): Promise<string> {
    const k = this.need();
    const terms = await this.orderOf(txid);
    const pay = await this.accountState(from);
    const receive = await this.accountState(to);
    const askToken = terms.askToken.every((b) => b === 0) ? '0' : addressOfMemory(terms.askToken);
    const maker = await this.call<any>('register/get/any', { address: addressOfMemory(terms.from) });
    if (pay.state.token !== askToken || receive.state.token !== String(maker.token ?? '0')) {
      throw new NexusError(-26, 'These accounts hold other tokens than this order trades');
    }
    if (String(maker.owner).toLowerCase() === k.genesis) {
      throw new NexusError(-26, 'This is your own order, cancel it instead');
    }
    return this.signAndSubmit(pin, (ts) => fillContracts(k.genesis, txid, terms, { address: from, state: pay.state }, { address: to, state: receive.state }, ts));
  }

  //AddVoid: the order's amount credited back into the account it came from
  override async cancelOrder(txid: string, pin: string): Promise<string> {
    const k = this.need();
    const tx = await this.call<Transaction & { genesis?: string }>('ledger/get/transaction', { hash: txid, verbose: 'detail' });
    if (tx.genesis?.toLowerCase() !== k.genesis) {
      throw new NexusError(-43, 'This order is not yours');
    }
    const terms = await this.orderOf(txid);
    const c = (tx.contracts ?? [])[terms.contract];
    if (Number(c?.claimed ?? 0) > 0) {
      throw new NexusError(-173, 'This order was filled already');
    }
    const from = addressOfMemory(terms.from);
    const state = (await this.accountState(from)).state;
    return this.submitCredits([{ debitTxid: txid, contract: terms.contract, to: { address: from, state }, from, amount: terms.amount }], new Map([[from, state]]), pin);
  }

  override async setStake(): Promise<string> {
    throw notHere('Changing the stake');
  }

  override async setStaking(): Promise<void> {
    throw notHere('Staking');
  }

  //the account is free, its name costs 1 NXS on a mother network, paid from the default account
  override async createAccount(name: string, token: string | undefined, pin: string): Promise<{ txid: string; address: string }> {
    const k = this.need();
    const label = name.trim();
    const tokenId = token && token !== '0' && token.toUpperCase() !== 'NXS' ? token : '0';
    if (label && (await this.call<any>('names/get/name', { name: `${k.username}:${label}` }).catch(() => null))) {
      throw new NexusError(-97, 'You already have something with this name');
    }
    if (tokenId !== '0' && (await this.call<any>('register/get/any', { address: tokenId }).catch(() => null))?.type !== 'TOKEN') {
      throw new NexusError(-57, 'That is not a token');
    }
    const fee = await this.feeOnNetwork(label ? nameFee : 0n);
    const pay = await this.feePayer(fee);
    const account = newAccountAddress();
    const txid = await this.signAndSubmit(pin, (ts) => [...accountContracts(k.genesis, label || undefined, tokenId, account, ts), ...pay(ts)]);
    return { txid, address: addressOfMemory(account) };
  }

  //hybrid and private networks charge nothing
  private async feeOnNetwork(fee: bigint): Promise<bigint> {
    const info = await this.info();
    return info.private || (info as { hybrid?: boolean }).hybrid ? 0n : fee;
  }

  //the fee contract out of the default NXS account, nothing when there is no fee
  private async feePayer(fee: bigint): Promise<(ts: number) => Uint8Array[]> {
    if (fee === 0n) {
      return () => [];
    }
    const k = this.need();
    const def = await this.call<any>('names/get/name', { name: `${k.username}:default` }).catch(() => null);
    if (!def?.register) {
      throw new NexusError(-163, 'Could not find your default NXS account to pay the fee');
    }
    const { state } = await this.accountState(def.register);
    if (state.balance < fee) {
      throw new NexusError(-214, `This costs ${Number(fee) / 1000000} NXS, your default account has less`);
    }
    return (ts) => [feeContract(memoryOfAddress(def.register), state, fee, ts)];
  }

  private async refuseTakenName(name: string, global: boolean): Promise<void> {
    const k = this.need();
    const found = await this.call<any>('names/get/name', { name: global ? name : `${k.username}:${name}` }).catch(() => null);
    if (found) {
      throw new NexusError(-97, 'This name is taken');
    }
  }

  //the name of a token is global, as in the core
  override async createToken(name: string, supply: number, decimals: number, pin: string): Promise<{ txid: string; address: string }> {
    const k = this.need();
    const label = name.trim();
    if (label) {
      await this.refuseTakenName(label, true);
    }
    const total = BigInt(supply) * 10n ** BigInt(decimals);
    const pay = await this.feePayer(await this.feeOnNetwork(tokenFee(total) + (label ? globalNameFee : 0n)));
    const token = newTokenAddress();
    const txid = await this.signAndSubmit(pin, (ts) => [tokenContract(k.genesis, token, total, decimals, ts), ...(label ? [nameContract(k.genesis, label, token, true, ts)] : []), ...pay(ts)]);
    return { txid, address: addressOfMemory(token) };
  }

  override async createName(name: string, register: string | undefined, global: boolean, pin: string): Promise<{ txid: string; address: string }> {
    const k = this.need();
    const label = name.trim();
    if (!register) {
      throw new NexusError(-28, 'A name has to point to a register');
    }
    await this.refuseTakenName(label, global);
    const pay = await this.feePayer(await this.feeOnNetwork(global ? globalNameFee : nameFee));
    const target = memoryOfAddress(register);
    const txid = await this.signAndSubmit(pin, (ts) => [nameContract(k.genesis, label, target, global, ts), ...pay(ts)]);
    return { txid, address: register };
  }

  override async createAsset(name: string, fields: Record<string, string>, pin: string): Promise<{ txid: string; address: string }> {
    const k = this.need();
    const label = name.trim();
    if (label) {
      await this.refuseTakenName(label, false);
    }
    const data = assetData(fields);
    const pay = await this.feePayer(await this.feeOnNetwork(objectFee(data.length) + (label ? nameFee : 0n)));
    const asset = newAssetAddress();
    const txid = await this.signAndSubmit(pin, (ts) => [assetContract(k.genesis, asset, data, ts), ...(label ? [nameContract(k.genesis, label, asset, false, ts)] : []), ...pay(ts)]);
    return { txid, address: addressOfMemory(asset) };
  }
}
