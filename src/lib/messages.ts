//requests from the popup to the background, all node calls go through the background
import type { NodeSettings } from './node';
import type { Account, Asset, Balance, Invoice, InvoiceItem, MarketOrder, Notification, SendRequest, Session, StakeInfo, Transaction, WalletStatus } from './types';
import type { ApprovalInfo } from './dapp';
import type { ConnectedSite } from './sites';

export interface RequestMap {
  status: { req: {}; res: WalletStatus };
  getNode: { req: {}; res: (NodeSettings & { hasPassword: boolean }) | null };
  saveNode: { req: { node: NodeSettings }; res: WalletStatus };
  savedNodes: { req: {}; res: { url: string; user: string; current: boolean }[] };
  switchNode: { req: { url: string; user: string }; res: WalletStatus };
  removeSavedNode: { req: { url: string; user: string }; res: null };
  login: { req: { username: string; password: string; pin: string }; res: Session };
  logout: { req: { pin: string }; res: null };
  createProfile: { req: { username: string; password: string; pin: string }; res: { txid: string } };
  recoverProfile: { req: { username: string; recovery: string; password: string; pin: string }; res: { txid: string } };
  updateCredentials: { req: { pin: string; newPassword?: string; newPin?: string }; res: { txid: string } };
  updateRecovery: { req: { pin: string; newRecovery: string; recovery?: string }; res: { txid: string } };
  balances: { req: {}; res: Balance[] };
  accounts: { req: {}; res: Account[] };
  transactions: { req: { limit: number; page: number }; res: Transaction[] };
  notifications: { req: {}; res: Notification[] };
  send: { req: SendRequest; res: { txid: string } };
  claim: { req: { txid: string; pin: string }; res: { txid: string } };
  claimAll: { req: { txids: string[]; pin: string }; res: { txid: string } };
  localNetwork: { req: {}; res: { userType: string; hybrid?: string } };
  profileExists: { req: { genesis: string }; res: boolean };
  submitGenesis: { req: { data: string; txid: string }; res: null };
  claimAsset: { req: { txid: string; pin: string }; res: { txid: string } };
  voidTx: { req: { txid: string; pin: string }; res: { txid: string } };
  createRegister: {
    req:
      | { kind: 'account'; name: string; token?: string; pin: string }
      | { kind: 'token'; name: string; supply: number; decimals: number; pin: string }
      | { kind: 'name'; name: string; register?: string; global: boolean; pin: string }
      | { kind: 'asset'; name: string; fields: Record<string, string>; pin: string };
    res: { txid: string; address: string };
  };
  stakeInfo: { req: {}; res: StakeInfo | null };
  setStake: { req: { amount: number; pin: string }; res: { txid: string } };
  setStaking: { req: { on: boolean; pin: string }; res: null };
  marketOrders: { req: { market: string }; res: { bids: MarketOrder[]; asks: MarketOrder[] } };
  myOrders: { req: { tokens: string[] }; res: MarketOrder[] };
  createOrder: { req: { order: 'bid' | 'ask'; market: string; amount: number; price: number; from: string; to: string; pin: string }; res: { txid: string } };
  executeOrder: { req: { txid: string; from: string; to: string; pin: string }; res: { txid: string } };
  cancelOrder: { req: { txid: string; pin: string }; res: { txid: string } };
  assets: { req: {}; res: Asset[] };
  transferAsset: { req: { address: string; recipient: string; pin: string }; res: { txid: string } };
  invoices: { req: {}; res: Invoice[] };
  invoice: { req: { address: string }; res: Invoice };
  payInvoice: { req: { address: string; from: string; pin: string }; res: { txid: string } };
  rejectInvoice: { req: { address: string; pin: string }; res: { txid: string } };
  createInvoice: { req: { to: string; recipient: string; items: InvoiceItem[]; reference?: string; pin: string }; res: { txid: string; address: string } };
  cancelInvoice: { req: { address: string; pin: string }; res: { txid: string } };
  //approval windows for website requests
  approvalGet: { req: { id: string }; res: ApprovalInfo };
  approvalDone: { req: { id: string; result: unknown }; res: null };
  approvalReject: { req: { id: string }; res: null };
  //signs the swap step of an open approval; the step comes from the request, not from the window
  approvalSwap: { req: { id: string; pin: string }; res: { txid: string } };
  sites: { req: {}; res: ConnectedSite[] };
  cryptoRegister: { req: {}; res: { address: string; owner: string; sign: string; auth: string } | null };
  lock: { req: {}; res: null };
  touch: { req: {}; res: null };
  unlock: { req: { pin: string }; res: null };
  unlockChallenge: { req: {}; res: string };
  unlockVerified: { req: { publicKey: string; signature: string }; res: null };
  getSettings: { req: {}; res: { lockMinutes: number } };
  setLockMinutes: { req: { minutes: number }; res: null };
  exportSettings: { req: {}; res: unknown };
  resetNode: { req: {}; res: null };
  signHere: { req: {}; res: WalletStatus };
  importSettings: { req: { data: unknown }; res: { node: NodeSettings | null; contacts: number } };
  removeSite: { req: { origin: string }; res: null };
}

export type RequestType = keyof RequestMap;

export type Message = { [K in RequestType]: { type: K } & RequestMap[K]['req'] }[RequestType];

export type Reply<T> = { ok: true; data: T } | { ok: false; error: { code: number; message: string } };

export class RequestError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

//popup side, throws RequestError with the node message
export async function ask<K extends RequestType>(type: K, req: RequestMap[K]['req'] = {} as RequestMap[K]['req']): Promise<RequestMap[K]['res']> {
  const reply = (await browser.runtime.sendMessage({ type, ...req })) as Reply<RequestMap[K]['res']> | undefined;
  if (!reply) {
    throw new RequestError(-1, 'The wallet background did not answer');
  }
  if (!reply.ok) {
    throw new RequestError(reply.error.code, reply.error.message);
  }
  return reply.data;
}
