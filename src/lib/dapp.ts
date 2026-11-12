import type { SignedText } from './signin';
import type { Balance, MarketOrder } from './types';
import type { SwapShown, SwapStep } from './swap-step';

//protocol between websites (window.nexus), the content script and the background

export const dappChannel = 'nexus-wallet';
export const dappPortName = 'nexus-dapp';

export const DappMethods = {
  Connect: 'nexus_connect',
  Disconnect: 'nexus_disconnect',
  GetAccounts: 'nexus_getAccounts',
  GetBalances: 'nexus_getBalances',
  GetNetwork: 'nexus_getNetwork',
  Send: 'nexus_send',
  GetAssets: 'nexus_getAssets',
  PayInvoice: 'nexus_payInvoice',
  GetOrders: 'nexus_getOrders',
  GetMyOrders: 'nexus_getMyOrders',
  FillOrder: 'nexus_fillOrder',
  PlaceOrder: 'nexus_placeOrder',
  CancelOrder: 'nexus_cancelOrder',
  SignIn: 'nexus_signIn',
  SignMessage: 'nexus_signMessage',
  SwapStep: 'nexus_swapStep',
} as const;

//same numbers as EIP-1193 so web developers know them
export const DappErrors = {
  UserRejected: 4001,
  Unauthorized: 4100,
  Unsupported: 4200,
  Disconnected: 4900,
  InvalidParams: -32602,
  Pending: -32002,
  Internal: -32603,
} as const;

export class DappError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

//what a site asked to send, checked in the background before any window opens
export interface SendParams {
  to: string;
  amount: number;
  token: string; //'0' = NXS, else token address or ticker
  reference?: string;
}

export type ApprovalKind = 'connect' | 'send' | 'sign' | 'invoice' | 'order' | 'swap';

export interface ApprovalInfo {
  id: string;
  kind: ApprovalKind;
  origin: string;
  params?: SendParams;
  //full text the wallet will sign, built in the background
  text?: string;
  //invoice register address for invoice requests
  invoice?: string;
  //market requests: what to do on which pair
  order?: OrderRequest;
  //swap step of the Nexus DEX, with what the wallet read from the chain for it
  swap?: { step: SwapStep; shown: SwapShown };
  //account the request was made for, the window refuses another one
  genesis?: string;
}

export type ApprovalDetails = Omit<ApprovalInfo, 'id' | 'kind' | 'origin'>;

export interface OrderRequest {
  action: 'fill' | 'place' | 'cancel';
  market: string;
  //the order to fill or cancel, looked up by the background
  found?: MarketOrder;
  side?: 'buy' | 'sell';
  amount?: number;
  price?: number;
}

const marketPattern = /^[^\s/]{1,64}\/[^\s/]{1,64}$/;

export function checkMarket(raw: unknown): string {
  if (typeof raw !== 'string' || !marketPattern.test(raw.trim())) {
    throw new DappError(DappErrors.InvalidParams, 'market must be two tokens like TOKEN/NXS');
  }
  return raw.trim();
}

export function checkTxid(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{128}$/i.test(raw)) {
    throw new DappError(DappErrors.InvalidParams, 'txid must be the 128 hex characters of the order transaction');
  }
  return raw.toLowerCase();
}

export function checkPlaceParams(raw: unknown): { side: 'buy' | 'sell'; amount: number; price: number } {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (p.side !== 'buy' && p.side !== 'sell') {
    throw new DappError(DappErrors.InvalidParams, 'side must be buy or sell');
  }
  const amount = Number(p.amount);
  const price = Number(p.price);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new DappError(DappErrors.InvalidParams, 'amount and price must be positive numbers');
  }
  return { side: p.side, amount, price };
}

const maxTextLength = 200;

export function checkSendParams(raw: unknown, isRecipient: (t: string) => boolean, isReference: (t: string) => boolean): SendParams {
  const p = (raw ?? {}) as Record<string, unknown>;
  const to = typeof p.to === 'string' ? p.to.trim() : '';
  if (!to || to.length > maxTextLength || !isRecipient(to)) {
    throw new DappError(DappErrors.InvalidParams, 'to must be an account address or name');
  }
  const amount = typeof p.amount === 'string' ? Number(p.amount) : p.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new DappError(DappErrors.InvalidParams, 'amount must be a positive number');
  }
  let token = '0';
  if (p.token !== undefined && p.token !== null && p.token !== '') {
    if (typeof p.token !== 'string' || p.token.length > maxTextLength) {
      throw new DappError(DappErrors.InvalidParams, 'token must be a token address or ticker');
    }
    token = p.token.trim().toUpperCase() === 'NXS' ? '0' : p.token.trim();
  }
  let reference: string | undefined;
  if (p.reference !== undefined && p.reference !== null && p.reference !== '') {
    reference = String(p.reference).trim();
    if (!isReference(reference)) {
      throw new DappError(DappErrors.InvalidParams, 'reference must be a whole number from 0 to 18446744073709551615');
    }
  }
  return { to, amount, token, reference };
}

export function originLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

//what websites get back from window.nexus; the developer package (sdk/) gives these types to sites
export interface DappAccount {
  address: string;
  name: string | null;
  type: string;
  token: string;
  ticker: string | null;
}

export interface DappConnectInfo {
  genesis: string;
  username: string;
  accounts: DappAccount[];
}

export interface DappNetwork {
  network: 'mainnet' | 'testnet' | 'private';
  blocks: number;
  synchronized: boolean;
}

export interface DappAsset {
  address: string;
  name: string | null;
  type: string;
  form: string | null;
  created?: number;
  modified?: number;
  owner?: string;
  fields: Record<string, unknown>;
}

type Market = { market: string };

//params and result of every method
export interface DappRequests {
  nexus_getNetwork: { params?: undefined; result: DappNetwork };
  nexus_connect: { params?: undefined; result: DappConnectInfo };
  nexus_disconnect: { params?: undefined; result: true };
  nexus_getAccounts: { params?: undefined; result: DappAccount[] };
  nexus_getBalances: { params?: undefined; result: Balance[] };
  nexus_send: { params: { to: string; amount: number | string; token?: string; reference?: string | number }; result: { txid: string } };
  nexus_getAssets: { params?: undefined; result: DappAsset[] };
  nexus_payInvoice: { params: { address: string }; result: { txid: string } };
  nexus_getOrders: { params: Market; result: { bids: MarketOrder[]; asks: MarketOrder[] } };
  nexus_getMyOrders: { params: Market; result: MarketOrder[] };
  nexus_fillOrder: { params: Market & { txid: string }; result: { txid: string } };
  nexus_placeOrder: { params: Market & { side: 'buy' | 'sell'; amount: number | string; price: number | string }; result: { txid: string } };
  nexus_cancelOrder: { params: Market & { txid: string }; result: { txid: string } };
  nexus_signIn: { params: { nonce: string; statement?: string }; result: SignedText };
  nexus_signMessage: { params: { message: string }; result: SignedText };
  nexus_swapStep: { params: SwapStep; result: { txid: string } };
}

export type DappMethod = keyof DappRequests;
