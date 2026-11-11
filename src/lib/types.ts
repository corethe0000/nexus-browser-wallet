//shapes of the node answers the wallet uses (only the fields we read)

export interface NodeInfo {
  version: string;
  testnet: number | boolean;
  private: boolean;
  multiuser: boolean;
  litemode: boolean;
  blocks: number;
  synchronized: boolean;
  syncing: boolean;
  connections: number;
}

export interface Session {
  genesis: string;
  username: string;
}

export interface Account {
  address: string;
  name?: string;
  type: string;
  token: string;
  ticker?: string;
  balance: number;
  total?: number;
  created?: number;
  modified?: number;
}

export interface Balance {
  token: string;
  ticker?: string;
  decimals: number;
  available: number;
  confirmed: number;
  unclaimed: number;
  unconfirmed: number;
  stake?: number;
  immature?: number;
}

export interface Party {
  address?: string;
  name?: string;
  user?: string;
  mine?: boolean;
  type?: string;
}

export interface Contract {
  id: number;
  OP: string;
  from?: Party | string;
  to?: Party | string;
  address?: string;
  name?: string;
  type?: string;
  object?: Record<string, unknown>;
  amount?: number;
  token?: string;
  ticker?: string;
  claimed?: number;
  reference?: number;
  for?: string;
  //the core's condition text, a send carries its expiry in it
  conditions?: string;
}

export interface Transaction {
  txid: string;
  type: string;
  sequence: number;
  timestamp: number;
  confirmations: number;
  contracts: Contract[];
}

//incoming debit nobody has claimed yet
export interface Notification extends Contract {
  txid: string;
  timestamp: number;
  form?: string;
}

export interface WalletStatus {
  locked?: boolean;
  //node on another machine: its operator sees the login
  remote?: boolean;
  //remote single-user node without API login (like the public seed nodes): one login for everyone who calls it
  sharedLogin?: boolean;
  //signing in this browser: no login on the node, some actions are not built for it yet
  localMode?: boolean;
  //the core address was changed since the last login
  nodeChange?: { from: string; to: string; at: number } | null;
  configured: boolean;
  node: NodeInfo | null;
  nodeError: { code: number; message: string } | null;
  session: Session | null;
}

export interface SendRequest {
  from: string;
  to: string;
  amount: number;
  reference?: string;
  //seconds the receiver has to claim, after that the sender can take it back; 0 = never expires
  expires?: number;
  pin: string;
}

export interface StakeInfo {
  address: string;
  balance: number;
  stake: number;
  trust: number;
  onhold: boolean;
  stakerate: number;
  trustweight: number;
  blockweight: number;
  stakeweight: number;
  staking: boolean;
  change: boolean;
  //seconds left before staking starts on a new or changed trust account
  holdtime?: number;
  new?: boolean;
  //pending stake change
  amount?: number;
  requested?: number;
  expires?: number;
}

//asset registers carry their own fields next to these
export interface Asset {
  address: string;
  name?: string;
  owner: string;
  type: string;
  form?: string;
  created: number;
  modified: number;
  [field: string]: unknown;
}

export interface InvoiceItem {
  description?: string;
  amount: number;
  units: number;
}

export interface Invoice {
  address: string;
  issuer: string;
  account: string;
  to?: string;
  recipient: string;
  items: InvoiceItem[];
  reference?: string;
  amount: number;
  token: string;
  status: string;
  created?: number;
}

export interface OrderSide {
  token: string;
  ticker?: string;
  amount: number;
}

export interface MarketOrder {
  txid: string;
  type: 'bid' | 'ask';
  market: string;
  owner: string;
  timestamp: number;
  give: OrderSide;
  want: OrderSide;
}
