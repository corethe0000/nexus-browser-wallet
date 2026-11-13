//market orders as the core lists them (market/list/order, market/user/order), shared by the wallet and the Nexus DEX
import type { MarketOrder, OrderSide } from './types';

//market answers give NXS in base units (1e6) and tokens in whole units (seen on mainnet by the explorer work)
const nxsBaseUnits = 1000000;

function side(c: any): OrderSide {
  const token = String(c?.token ?? '0');
  const raw = Number(c?.amount ?? 0);
  return { token, ticker: c?.ticker ?? (token === '0' ? 'NXS' : undefined), amount: token === '0' ? raw / nxsBaseUnits : raw };
}

//give = what the order's owner pays, want = what the owner gets back
export function toOrder(o: any): MarketOrder {
  return { txid: o.txid, type: o.type, market: o.market, owner: o.owner, timestamp: o.timestamp, give: side(o.contract), want: side(o.order) };
}
