import { callNode, NexusError, type NodeSettings } from './node';
import type { Account, Asset, Balance, Invoice, InvoiceItem, MarketOrder, NodeInfo, Notification, OrderSide, SendRequest, Session, StakeInfo, Transaction } from './types';

//node error codes we react to
const sessionNotFound = -11;
//multi-user node asked without a session
const missingParameter = -56;
const trustNotFound = -70;
const sigchainNotSynced = -23;
const invoiceTransferNotFound = -247;
const invoiceSearchPages = 5;

//market answers give NXS in base units (1e6) and tokens in whole units (seen on mainnet by the explorer work)
const nxsBaseUnits = 1000000;

function side(c: any): OrderSide {
  const token = String(c?.token ?? '0');
  const raw = Number(c?.amount ?? 0);
  return { token, ticker: c?.ticker ?? (token === '0' ? 'NXS' : undefined), amount: token === '0' ? raw / nxsBaseUnits : raw };
}

//give = what the order's owner pays, want = what the owner gets back
function toOrder(o: any): MarketOrder {
  return { txid: o.txid, type: o.type, market: o.market, owner: o.owner, timestamp: o.timestamp, give: side(o.contract), want: side(o.order) };
}

//invoice registers keep their fields under json
function toInvoice(r: any): Invoice {
  const j = r?.json ?? r ?? {};
  return {
    address: r.address,
    issuer: r.owner,
    account: j.account,
    to: j.to,
    recipient: j.recipient,
    items: Array.isArray(j.items) ? j.items : [],
    reference: typeof j.reference === 'string' ? j.reference : undefined,
    amount: Number(j.amount ?? 0),
    token: String(j.token ?? '0'),
    status: j.status ?? 'OUTSTANDING',
    created: r.created,
  };
}

//wallet actions on one node: single-user API mode (desktop wallet core) without session,
//multi-user nodes (one node for many people) with the session id this wallet got at login
export class Wallet {
  constructor(
    protected node: NodeSettings,
    private fetcher: typeof fetch = fetch,
    private sessionId?: string,
    //multi-user nodes do not tell the username of a session
    private sessionUser?: string,
  ) {}

  protected call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return callNode<T>(this.node, method, this.sessionId ? { ...params, session: this.sessionId } : params, this.fetcher);
  }

  info(): Promise<NodeInfo> {
    return this.call<NodeInfo>('system/get/info');
  }

  //null when nobody is logged in on the node
  async session(): Promise<Session | null> {
    try {
      const st = await this.call<any>('profiles/status/master');
      return { genesis: st.genesis, username: st.session?.username ?? this.sessionUser ?? '' };
    } catch (e) {
      if (e instanceof NexusError && (e.code === sessionNotFound || e.code === missingParameter)) {
        return null;
      }
      throw e;
    }
  }

  //session is set on multi-user nodes only
  async login(username: string, password: string, pin: string): Promise<Session & { session?: string }> {
    const r = await this.call<any>('sessions/create/local', { username, password, pin });
    return { genesis: r.genesis, username, session: r.session };
  }

  //a new signature chain; the core needs the next block before it can be used
  async createProfile(username: string, password: string, pin: string): Promise<string> {
    const r = await this.call<any>('profiles/create/master', { username, password, pin });
    return r.txid;
  }

  //new password, new PIN or both, signed with the current ones
  async updateCredentials(pin: string, newPassword: string | undefined, newPin: string | undefined): Promise<string> {
    const params: Record<string, unknown> = { pin };
    if (newPassword) {
      params.new_password = newPassword;
    }
    if (newPin) {
      params.new_pin = newPin;
    }
    const r = await this.call<any>('profiles/update/credentials', params);
    return r.txid;
  }

  //the core asks for the old phrase when one was set before
  async updateRecovery(pin: string, newRecovery: string, recovery: string | undefined): Promise<string> {
    const params: Record<string, unknown> = { pin, new_recovery: newRecovery };
    if (recovery) {
      params.recovery = recovery;
    }
    const r = await this.call<any>('profiles/update/recovery', params);
    return r.txid;
  }

  //sets a new password and PIN with the recovery phrase, no login needed
  async recoverProfile(username: string, recovery: string, password: string, pin: string): Promise<string> {
    const r = await this.call<any>('profiles/recover/master', { username, recovery, password, pin });
    return r.txid;
  }

  //a transaction signed elsewhere (ledger/submit/transaction), the txid the node gives back
  async submitRaw(data: string): Promise<string | undefined> {
    const r = await this.call<{ hash?: string }>('ledger/submit/transaction', { data });
    return r?.hash;
  }

  //true or false, older cores do not have this command
  async validatePin(pin: string): Promise<boolean> {
    return this.call<boolean>('sessions/validate/pin', { pin });
  }

  async logout(pin: string): Promise<void> {
    await this.call('sessions/terminate/local', { pin });
  }

  balances(): Promise<Balance[]> {
    return this.call<Balance[]>('finance/get/balances');
  }

  async accounts(): Promise<Account[]> {
    const list = (await this.call<Account[]>('finance/list/accounts')) ?? [];
    try {
      const trust = await this.call<Account>('finance/get/trust');
      if (trust?.address && !list.some((a) => a.address === trust.address)) {
        list.push({ ...trust, type: 'TRUST', ticker: trust.ticker ?? 'NXS' });
      }
    } catch {
      //no trust account yet, normal for a new profile
    }
    return list;
  }

  async transactions(limit: number, page: number): Promise<Transaction[]> {
    return (await this.call<Transaction[]>('profiles/transactions/master', { limit, page, verbose: 'summary', order: 'desc' })) ?? [];
  }

  async notifications(): Promise<Notification[]> {
    return (await this.call<Notification[]>('profiles/notifications/master', { limit: 100 })) ?? [];
  }

  async send(req: SendRequest): Promise<string> {
    const params: Record<string, unknown> = { from: req.from, to: req.to.trim(), amount: req.amount, pin: req.pin };
    if (req.reference) {
      params.reference = req.reference;
    }
    if (req.expires !== undefined) {
      params.expires = req.expires;
    }
    const r = await this.call<any>('finance/debit/account', params);
    return r.txid;
  }

  //null when the profile has no trust account yet
  async stakeInfo(): Promise<StakeInfo | null> {
    try {
      return await this.call<StakeInfo>('finance/get/stakeinfo');
    } catch (e) {
      if (e instanceof NexusError && e.code === trustNotFound) {
        return null;
      }
      throw e;
    }
  }

  //new total stake; more than now comes from the trust account balance, the change waits for the next stake block
  async setStake(amount: number, pin: string): Promise<string> {
    const r = await this.call<any>('finance/set/stake', { amount, pin });
    return r?.txid ?? '';
  }

  //starts or stops the core's stake minter for this profile, single-user cores only
  async setStaking(on: boolean, pin: string): Promise<void> {
    await this.call(on ? 'sessions/unlock/local' : 'sessions/lock/local', { pin, staking: true });
  }

  async assets(): Promise<Asset[]> {
    return (await this.call<Asset[]>('assets/list/asset', { limit: 100 })) ?? [];
  }

  async claimAsset(txid: string, pin: string): Promise<string> {
    const r = await this.call<any>('assets/claim/asset', { txid, pin });
    return r.txid;
  }

  async transferAsset(address: string, recipient: string, pin: string): Promise<string> {
    const r = await this.call<any>('assets/transfer/asset', { address, recipient: recipient.trim(), pin });
    return r.txid;
  }

  //invoices other users sent to this profile and not paid yet
  async invoices(): Promise<Invoice[]> {
    const list = (await this.call<any[]>('invoices/list/outstanding', { limit: 100 })) ?? [];
    return list.map(toInvoice);
  }

  async invoice(address: string): Promise<Invoice> {
    return toInvoice(await this.call<any>('invoices/get/invoice', { address }));
  }

  async payInvoice(address: string, from: string, pin: string): Promise<string> {
    const r = await this.call<any>('invoices/pay/invoice', { address, from, pin });
    return r.txid;
  }

  //to = our account that gets paid, recipient = username or genesis of the payer
  async createInvoice(inv: { to: string; recipient: string; items: InvoiceItem[]; reference?: string; pin: string }): Promise<{ txid: string; address: string }> {
    const params: Record<string, unknown> = { to: inv.to, recipient: inv.recipient.trim(), items: inv.items, pin: inv.pin };
    if (inv.reference) {
      params.reference = inv.reference;
    }
    return this.call('invoices/create/invoice', params);
  }

  //only the issuer, only while the invoice is not paid
  async cancelInvoice(address: string, pin: string): Promise<string> {
    try {
      const r = await this.call<any>('invoices/cancel/invoice', { address, pin });
      return r.txid;
    } catch (e) {
      //the core's cancel looks the invoice up in the payer's sigchain, which only works when the payer is on this node too
      if (!(e instanceof NexusError) || ![sigchainNotSynced, invoiceTransferNotFound].includes(e.code)) {
        throw e;
      }
    }
    //same as the core does: void the transfer of the invoice (its condition lets the issuer take it back)
    if ((await this.invoice(address)).status !== 'OUTSTANDING') {
      throw new NexusError(invoiceTransferNotFound, 'This invoice is not open any more');
    }
    const txid = await this.invoiceTxid(address);
    if (!txid) {
      throw new NexusError(invoiceTransferNotFound, 'Could not find the transaction of this invoice');
    }
    return this.voidTx(txid, pin);
  }

  //the transaction that made and sent an invoice, searched in the newest transactions of this profile
  private async invoiceTxid(address: string): Promise<string | null> {
    for (let page = 0; page < invoiceSearchPages; page++) {
      const list = await this.transactions(100, page);
      const tx = list.find((t) => t.contracts?.some((c) => c.OP === 'CREATE' && c.address === address) && t.contracts.some((c) => c.OP === 'TRANSFER' && c.address === address));
      if (tx) {
        return tx.txid;
      }
      if (list.length < 100) {
        break;
      }
    }
    return null;
  }

  async rejectInvoice(address: string, pin: string): Promise<string> {
    const r = await this.call<any>('invoices/reject/invoice', { address, pin });
    return r.txid;
  }

  //order book of a pair A/B (tickers or token addresses)
  async marketOrders(market: string): Promise<{ bids: MarketOrder[]; asks: MarketOrder[] }> {
    const r = await this.call<any>('market/list/order', { market, limit: 100 });
    return { bids: (r?.bids ?? []).map(toOrder), asks: (r?.asks ?? []).map(toOrder) };
  }

  //market/user/order needs a token, so ask once per token and drop doubles
  async myOrders(tokens: string[]): Promise<MarketOrder[]> {
    const seen = new Map<string, MarketOrder>();
    for (const token of tokens) {
      try {
        const r = await this.call<any>('market/user/order', { token, limit: 100 });
        for (const o of r?.orders ?? []) {
          if (!seen.has(o.txid)) {
            seen.set(o.txid, toOrder(o));
          }
        }
      } catch {
        //no orders for this token
      }
    }
    return [...seen.values()].sort((a, b) => b.timestamp - a.timestamp);
  }

  async createOrder(o: { type: 'bid' | 'ask'; market: string; amount: number; price: number; from: string; to: string; pin: string }): Promise<string> {
    const r = await this.call<any>(`market/create/${o.type}`, { market: o.market, amount: o.amount, price: o.price, from: o.from, to: o.to, pin: o.pin });
    return r.txid;
  }

  async executeOrder(txid: string, from: string, to: string, pin: string): Promise<string> {
    const r = await this.call<any>('market/execute/order', { txid, from, to, pin });
    return r.txid;
  }

  async cancelOrder(txid: string, pin: string): Promise<string> {
    const r = await this.call<any>('market/cancel/order', { txid, pin });
    return r.txid;
  }

  //crypto register of a signature chain, readable without login
  async cryptoRegister(address: string): Promise<{ owner: string; sign: string; auth: string } | null> {
    try {
      const r = await this.call<any>('register/get/crypto', { address });
      return r ? { owner: r.owner, sign: r.sign, auth: r.auth } : null;
    } catch {
      return null;
    }
  }

  //new registers; the core names them in the user's namespace unless global is asked
  async createAccount(name: string, token: string | undefined, pin: string): Promise<{ txid: string; address: string }> {
    const params: Record<string, unknown> = { name, pin };
    if (token && token !== '0' && token.toUpperCase() !== 'NXS') {
      params.token = token;
    }
    return this.call('finance/create/account', params);
  }

  async createToken(name: string, supply: number, decimals: number, pin: string): Promise<{ txid: string; address: string }> {
    return this.call('finance/create/token', { name, supply, decimals, pin });
  }

  async createName(name: string, register: string | undefined, global: boolean, pin: string): Promise<{ txid: string; address: string }> {
    const params: Record<string, unknown> = { name, pin };
    if (register) {
      params.register = register;
    }
    if (global) {
      params.global = true;
    }
    return this.call('names/create/name', params);
  }

  //basic format: every field is its own parameter
  async createAsset(name: string, fields: Record<string, string>, pin: string): Promise<{ txid: string; address: string }> {
    return this.call('assets/create/asset', { ...fields, name, format: 'basic', pin });
  }

  //takes back a debit or transfer the receiver has not claimed yet
  async voidTx(txid: string, pin: string): Promise<string> {
    const r = await this.call<any>('finance/void/transaction', { txid, pin });
    return r.hash ?? r.txid;
  }

  async claim(txid: string, pin: string): Promise<string> {
    const r = await this.call<any>('finance/credit/account', { txid, pin });
    return r.txid;
  }
}
