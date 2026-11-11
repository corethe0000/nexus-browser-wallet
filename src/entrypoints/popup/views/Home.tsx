import { useCallback, useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, formatTime, shortHash } from '../../../lib/format';
import type { Account, Asset, Balance, Contract, Invoice, Notification, Party, StakeInfo, Transaction } from '../../../lib/types';
import type { TextKey } from '../../../lib/i18n';
import { isClaimable } from '../../../lib/claims';
import { useApp } from '../context';
import { ErrorBox, Header, Spinner, Ticker } from '../components';

const pageSize = 20;
//token lines on the home screen before "show all", so the tabs stay in sight
const tokensShown = 4;

type Tab = 'accounts' | 'assets' | 'invoices' | 'activity';
//keeps the tab when coming back from a detail page
let lastTab: Tab = 'accounts';

//fields every register has, the rest are the asset's own
export const registerFields = new Set(['address', 'name', 'owner', 'version', 'type', 'form', 'created', 'modified']);

export function assetSummary(a: Asset): string {
  const own = Object.entries(a).filter(([k]) => !registerFields.has(k));
  const title = own.find(([k]) => k === 'title' || k === 'description')?.[1];
  return title ? String(title) : `${own.length} fields`;
}
//the node needs a moment to put a new tx in a block
const refreshMs = 15000;

export function NetworkBadge() {
  const { t, status } = useApp();
  const n = status.node;
  if (!n) {
    return null;
  }
  const net = n.private ? t.privateNet : n.testnet ? t.testnet : t.mainnet;
  return (
    <div className="net-row">
      <span className={`dot ${n.synchronized ? 'ok' : 'warn'}`} />
      <span>{net}</span>
      <span className="muted">#{n.blocks.toLocaleString('en-US')}</span>
    </div>
  );
}

export function Home() {
  const { t, status, go, refresh } = useApp();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [incoming, setIncoming] = useState<Notification[]>([]);
  const [stake, setStake] = useState<StakeInfo | null>(null);
  const [allTokens, setAllTokens] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const toPay = invoices.filter((i) => i.recipient === status.session?.genesis).length;
  const [tab, setTab] = useState<Tab>(lastTab);
  const [error, setError] = useState<string | null>(null);

  //each part shows as soon as its call answers, a slow one does not hold up the others
  const load = useCallback(async () => {
    const fail = (e: unknown) => setError((e as Error).message);
    //the core answers these with an error for a while after login, they come with the next refresh
    const quiet = () => {};
    await Promise.all([
      ask('balances').then((b) => {
        setBalances(b);
        setError(null);
      }, fail),
      ask('accounts').then(setAccounts, fail),
      ask('notifications').then((n) => setIncoming(n.filter((x) => isClaimable(x))), quiet),
      ask('stakeInfo').then(setStake, quiet),
      ask('invoices').then(setInvoices, quiet),
    ]);
  }, []);

  const pick = (t: Tab) => {
    lastTab = t;
    setTab(t);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, refreshMs);
    return () => clearInterval(timer);
  }, [load]);

  const nxs = balances?.find((b) => b.token === '0');
  const tokens = balances?.filter((b) => b.token !== '0') ?? [];

  return (
    <>
      <Header
        title={status.session?.username || shortHash(status.session?.genesis)}
        right={
          <>
          <button
            className="icon-btn"
            onClick={() => ask('lock').then(refresh)}
            aria-label={t.lockNow}
            title={t.lockNow}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <button className="icon-btn" onClick={() => go({ name: 'settings' })} aria-label={t.settings} title={t.settings}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 002 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          </>
        }
      />
      <div className="page">
        <NetworkBadge />
        {status.node && !status.node.synchronized && <div className="notice warn">{t.notSynced}</div>}
        <ErrorBox error={error} />

        <section className="balance-card">
          <div className="muted small">{t.total}</div>
          <div className="balance-big">
            {balances ? formatAmount((nxs?.available ?? 0) + (nxs?.stake ?? 0), 6) : error ? '-' : '...'} <span className="unit">NXS</span>
          </div>
          {nxs && (nxs.unclaimed > 0 || nxs.unconfirmed > 0 || (nxs.stake ?? 0) > 0) && (
            <div className="balance-parts small">
              {(nxs.stake ?? 0) > 0 && (
                <span>
                  {t.staked} {formatAmount(nxs.stake)}
                </span>
              )}
              {nxs.unclaimed > 0 && (
                <span>
                  {t.unclaimed} {formatAmount(nxs.unclaimed)}
                </span>
              )}
              {nxs.unconfirmed > 0 && (
                <span>
                  {t.unconfirmed} {formatAmount(nxs.unconfirmed)}
                </span>
              )}
            </div>
          )}
          <div className="row actions">
            <button className="btn primary" onClick={() => go({ name: 'send' })}>
              {t.send}
            </button>
            <button className="btn" onClick={() => go({ name: 'receive' })}>
              {t.receive}
            </button>
            <button className="btn" onClick={() => go({ name: 'market' })}>
              {t.market}
            </button>
          </div>
        </section>

        {incoming.length > 0 && (
          <button className="notice info clickable" onClick={() => go({ name: 'claim' })}>
            <strong>
              {t.incoming}: {incoming.length}
            </strong>
            <span>{t.claim}</span>
          </button>
        )}

        {tokens.length > 0 && (
          <ul className="list tokens">
            {(allTokens ? tokens : tokens.slice(0, tokensShown)).map((b) => (
              <li key={b.token}>
                <Ticker ticker={b.ticker} token={b.token} />
                <span className="grow" />
                <span className="amount">{formatAmount(b.available, b.decimals)}</span>
                {b.unclaimed > 0 && <span className="small muted">+{formatAmount(b.unclaimed, b.decimals)}</span>}
              </li>
            ))}
            {tokens.length > tokensShown && (
              <li>
                <button className="btn tiny ghost more" onClick={() => setAllTokens(!allTokens)}>
                  {allTokens ? t.showLess : t.showAll.replace('{n}', String(tokens.length))}
                </button>
              </li>
            )}
          </ul>
        )}

        {stake && <StakeCard s={stake} />}

        <div className="tabs">
          {(['accounts', 'assets', 'invoices', 'activity'] as const).map((k) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => pick(k)}>
              {t[k]}
              {k === 'invoices' && toPay > 0 && <span className="badge">{toPay}</span>}
            </button>
          ))}
        </div>
        {tab === 'accounts' && <Accounts accounts={accounts} />}
        {tab === 'assets' && <Assets />}
        {tab === 'invoices' && <Invoices invoices={invoices} balances={balances ?? []} />}
        {tab === 'activity' && <Activity />}
      </div>
    </>
  );
}

const pct = (v: number | undefined) => `${Number(v ?? 0).toFixed(2)} %`;

//finance/get/stakeinfo: weights and rate only mean something while the core's stake minter runs
function StakeCard({ s }: { s: StakeInfo }) {
  const { t, go, status } = useApp();
  const running = s.staking && !s.onhold;
  return (
    <section className="card stake-card">
      <div className="row-between">
        <h2>{t.staking}</h2>
        <span className={`pill ${running ? 'ok' : s.onhold ? 'warn' : ''}`}>{s.onhold ? t.stakeOnHold : s.staking ? t.stakeActive : t.stakeOff}</span>
      </div>
      <dl className="review">
        <dt>{t.staked}</dt>
        <dd>{formatAmount(s.stake)} NXS</dd>
        {s.balance > 0 && (
          <>
            <dt>{t.trustBalance}</dt>
            <dd>{formatAmount(s.balance)} NXS</dd>
          </>
        )}
        <dt>{t.stakeRate}</dt>
        <dd>{pct(s.stakerate)}</dd>
        {running && (
          <>
            <dt>{t.trustWeight}</dt>
            <dd>{pct(s.trustweight)}</dd>
            <dt>{t.blockWeight}</dt>
            <dd>{pct(s.blockweight)}</dd>
            <dt>{t.stakeWeight}</dt>
            <dd>{pct(s.stakeweight)}</dd>
          </>
        )}
      </dl>
      {s.onhold && <p className="small muted">{t.stakeHoldText.replace('{min}', String(Math.max(1, Math.ceil((s.holdtime ?? 0) / 60))))}</p>}
      {s.change && s.amount !== undefined && (
        <div className="notice info small">{t.stakeChangeText.replace('{amount}', formatAmount(s.amount))}</div>
      )}
      {!s.staking && <p className="small muted">{t.stakeHint}</p>}
      {!status.localMode && (
        <button className="btn small block" onClick={() => go({ name: 'stake' })}>
          {t.manageStake}
        </button>
      )}
    </section>
  );
}

function Assets() {
  const { t, go } = useApp();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ask('assets').then(setAssets, (e) => setError((e as Error).message));
  }, []);
  if (error) {
    return <ErrorBox error={error} />;
  }
  if (!assets) {
    return <Spinner />;
  }
  const add = (
    <button className="btn small block ghost" onClick={() => go({ name: 'create', kind: 'asset' })}>
      + {t.newAsset}
    </button>
  );
  if (!assets.length) {
    return (
      <>
        <p className="empty">{t.noAssets}</p>
        {add}
      </>
    );
  }
  return (
    <>
    <ul className="list">
      {assets.map((a) => (
        <li key={a.address} className="clickable" onClick={() => go({ name: 'asset', address: a.address })}>
          <div className="grow">
            <div className="name">{a.name || shortHash(a.address)}</div>
            <div className="small muted">
              {assetSummary(a)} · <span className="mono">{shortHash(a.address, 6)}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
    {add}
    </>
  );
}

//invoices/list/outstanding gives the ones to pay and the ones this profile sent and nobody paid yet
function Invoices({ invoices, balances }: { invoices: Invoice[]; balances: Balance[] }) {
  const { t, go, status } = useApp();
  const me = status.session?.genesis;
  const toPay = invoices.filter((i) => i.recipient === me);
  const sent = invoices.filter((i) => i.recipient !== me);
  const row = (inv: Invoice, mine: boolean) => {
    const b = balances.find((x) => x.token === inv.token);
    return (
      <li key={inv.address} className="clickable" onClick={() => go({ name: 'invoice', address: inv.address })}>
        <div className="grow">
          <div className="name">{inv.items[0]?.description || inv.reference || shortHash(inv.address)}</div>
          <div className="small muted">
            {mine ? (inv.to && inv.to.length < 40 ? inv.to : shortHash(inv.to || inv.account, 6)) :`${t.invoiceFor} ${shortHash(inv.recipient, 6)}`} · {formatTime(inv.created)}
          </div>
        </div>
        <div className={`amount ${mine ? 'out' : 'in'}`}>
          {formatAmount(inv.amount, b?.decimals ?? 6)} <Ticker ticker={b?.ticker ?? (inv.token === '0' ? 'NXS' : undefined)} token={inv.token} />
        </div>
      </li>
    );
  };
  return (
    <>
      {toPay.length === 0 && <p className="empty">{t.noInvoices}</p>}
      {toPay.length > 0 && <ul className="list">{toPay.map((i) => row(i, true))}</ul>}
      {sent.length > 0 && (
        <>
          <h3 className="list-title">{t.invoicesSent}</h3>
          <ul className="list">{sent.map((i) => row(i, false))}</ul>
        </>
      )}
      <button className="btn small block ghost" onClick={() => go({ name: 'newInvoice' })}>
        + {t.newInvoice}
      </button>
    </>
  );
}

function Accounts({ accounts }: { accounts: Account[] | null }) {
  const { t, go } = useApp();
  if (!accounts) {
    return <Spinner />;
  }
  const add = (
    <button className="btn small block ghost" onClick={() => go({ name: 'create', kind: 'account' })}>
      + {t.newRegister}
    </button>
  );
  if (!accounts.length) {
    return (
      <>
        <p className="empty">{t.noAccounts}</p>
        {add}
      </>
    );
  }
  return (
    <>
    <ul className="list">
      {accounts.map((a) => (
        <li key={a.address} className="account">
          <div className="grow">
            <div className="name">{a.name || t.unnamedAccount}</div>
            <div className="small muted mono">{shortHash(a.address, 8)}</div>
          </div>
          <div className="right">
            <div className="amount">
              {formatAmount(a.balance)} <Ticker ticker={a.ticker} token={a.token} />
            </div>
            <div className="row tight">
              <button className="btn tiny" onClick={() => go({ name: 'send', from: a.address })} disabled={a.type === 'TRUST'}>
                {t.send}
              </button>
              <button className="btn tiny" onClick={() => go({ name: 'receive', account: a.address })} disabled={a.type === 'TRUST'}>
                {t.receive}
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
    {add}
    </>
  );
}

//the core names other users' accounts without the user, so the start of the address tells them apart
export function partName(p: Party | string | undefined): string {
  if (!p) {
    return '';
  }
  if (typeof p === 'string') {
    return shortHash(p);
  }
  if (p.name) {
    if (p.mine) {
      return p.name;
    }
    return p.user ? `${p.user}:${p.name}` : `${p.name} (${shortHash(p.address, 4)})`;
  }
  return shortHash(p.address);
}

type Texts = Record<TextKey, string>;

//label for contracts that move no value, null = not worth a line (name records made with an account)
function describeOther(c: Contract, t: Texts): string | null {
  const obj = (c.object ?? {}) as Record<string, unknown>;
  if (c.OP === 'CREATE') {
    switch (c.type) {
      case 'ACCOUNT':
        return `${t.opNewAccount} ${c.name ?? shortHash(c.address)} (${String(obj.ticker ?? 'NXS')})`;
      case 'TOKEN':
        return `${t.opNewToken} ${c.name ?? shortHash(c.address)}`;
      case 'CRYPTO':
        return t.opKeys;
      case 'NAME':
        return null;
      default:
        return `${t.opNew} ${(c.type ?? '').toLowerCase()} ${c.name ?? shortHash(c.address)}`;
    }
  }
  return c.name ?? shortHash(c.address);
}

export interface Described {
  //short word for the kind of entry, shown as a tag
  tag: string;
  label: string;
  amount?: string;
  sign: '' | '+' | '-';
}

//one line per contract in words; null = not worth a line
export function describe(c: Contract & { exchange?: boolean; form?: string }, t?: Texts): Described | null {
  const ticker = c.ticker || (c.token && c.token !== '0' ? shortHash(c.token, 4) : 'NXS');
  const amount = c.amount !== undefined ? `${formatAmount(c.amount)} ${ticker}` : undefined;
  const from = typeof c.from === 'object' ? c.from : undefined;
  const to = typeof c.to === 'object' ? c.to : undefined;
  const w = (key: TextKey, fallback: string) => (t ? t[key] : fallback);
  switch (c.OP) {
    case 'DEBIT':
      //a market order pays into the order, not to an account
      if (c.exchange || !c.to) {
        return { tag: w('tagMarket', 'market'), label: `${w('actMarketFrom', 'From')} ${partName(c.from)}`, amount, sign: '-' };
      }
      if (to?.mine && from?.mine) {
        return { tag: w('tagMove', 'move'), label: `${partName(c.from)} > ${partName(c.to)}`, amount, sign: '' };
      }
      return { tag: w('tagSent', 'sent'), label: `${w('actTo', 'To')} ${partName(c.to)}`, amount, sign: '-' };
    case 'CREDIT':
      return { tag: w('tagReceived', 'received'), label: `${w('actInto', 'Into')} ${partName(c.to ?? c.from)}`, amount, sign: '+' };
    case 'COINBASE':
    case 'TRUST':
    case 'GENESIS':
      return { tag: w('tagReward', 'reward'), label: c.OP === 'COINBASE' ? w('actMined', 'Mining reward') : w('actStake', 'Staking reward'), amount, sign: '+' };
    case 'FEE':
      return { tag: w('tagFee', 'fee'), label: w('actFee', 'Transaction fee'), amount, sign: '-' };
    case 'CLAIM':
      if (c.form === 'INVOICE') {
        return { tag: w('tagInvoice', 'invoice'), label: `${w('actInvoicePaid', 'Invoice paid')} ${shortHash(c.address, 4)}`, sign: '' };
      }
      return { tag: w('tagAsset', 'asset'), label: `${w('actAssetIn', 'Received')} ${c.name ?? shortHash(c.address, 4)}`, sign: '' };
    case 'TRANSFER':
      if (c.form === 'INVOICE') {
        return { tag: w('tagInvoice', 'invoice'), label: `${w('actInvoiceSent', 'Invoice sent')} ${shortHash(c.address, 4)}`, sign: '' };
      }
      return { tag: w('tagAsset', 'asset'), label: `${w('actAssetOut', 'Sent')} ${c.name ?? shortHash(c.address, 4)}`, sign: '' };
    default: {
      const label = t ? describeOther(c, t) : c.OP.toLowerCase();
      return label === null ? null : { tag: c.OP === 'CREATE' ? w('tagNew', 'new') : c.OP.toLowerCase(), label, amount: undefined, sign: '' };
    }
  }
}

function Activity() {
  const { t, go } = useApp();
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ask('transactions', { limit: pageSize, page })
      .then((list) => {
        setTxs((prev) => (page === 0 ? list : [...(prev ?? []), ...list]));
        setMore(list.length === pageSize);
      })
      .catch((e) => setError((e as Error).message));
  }, [page]);

  if (error) {
    return <ErrorBox error={error} />;
  }
  if (!txs) {
    return <Spinner />;
  }
  if (!txs.length) {
    return <p className="empty">{t.noActivity}</p>;
  }
  return (
    <>
      <ul className="list activity">
        {txs.map((tx) =>
          tx.contracts.map((c) => {
            const d = describe(c, t);
            if (!d) {
              return null;
            }
            return (
              <li key={`${tx.txid}-${c.id}`} className="clickable" onClick={() => go({ name: 'tx', tx })}>
                <div className="grow">
                  <div className="name">
                    <span className={`op op-${c.OP.toLowerCase()}`}>{d.tag}</span> {d.label}
                  </div>
                  <div className="small muted">
                    {formatTime(tx.timestamp)} · {tx.confirmations > 0 ? t.confirmed : t.pending}
                  </div>
                </div>
                {d.amount && (
                  <div className={`amount ${d.sign === '+' ? 'in' : d.sign === '-' ? 'out' : ''}`}>
                    {d.sign}
                    {d.amount}
                  </div>
                )}
              </li>
            );
          }),
        )}
      </ul>
      {more && (
        <button className="btn block" onClick={() => setPage(page + 1)}>
          {t.loadMore}
        </button>
      )}
    </>
  );
}
