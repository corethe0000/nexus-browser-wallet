import { useCallback, useEffect, useMemo, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, formatTime, parseAmount, shortHash } from '../../../lib/format';
import type { Account, Balance, MarketOrder } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Header, Spinner } from '../components';

//token label as the market API takes it: ticker, else the token address
export interface TokenChoice {
  id: string;
  label: string;
  token: string;
  decimals: number;
}

//price of A in B, from the amounts (the price field of the API is not used)
function priceOf(o: MarketOrder, a: string): number {
  return o.give.token === a ? o.want.amount / o.give.amount : o.give.amount / o.want.amount;
}

//amount of A in an order
function amountOfA(o: MarketOrder, a: string): number {
  return o.give.token === a ? o.give.amount : o.want.amount;
}

function pickAccount(accounts: Account[], token: string): Account | undefined {
  return accounts.filter((x) => x.token === token && x.type !== 'TRUST').sort((x, y) => y.balance - x.balance)[0];
}

export type Action = { kind: 'fill'; order: MarketOrder } | { kind: 'cancel'; order: MarketOrder } | { kind: 'new' };

export interface OrderPreset {
  side: 'ask' | 'bid';
  amount: number;
  price: number;
}

//token choices of the user for a pair named by tickers or addresses
export function choicesFor(balances: Balance[], market: string): [TokenChoice, TokenChoice] {
  const pick = (id: string): TokenChoice => {
    const b = balances.find((x) => x.token === id || (x.ticker && x.ticker.toUpperCase() === id.toUpperCase()) || (id.toUpperCase() === 'NXS' && x.token === '0'));
    return b ? { id, label: b.ticker || shortHash(b.token, 4), token: b.token, decimals: b.decimals } : { id, label: id, token: id, decimals: 8 };
  };
  const [a, b] = market.split('/') as [string, string];
  return [pick(a), pick(b)];
}

export function Market() {
  const { t, go, status } = useApp();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [book, setBook] = useState<{ bids: MarketOrder[]; asks: MarketOrder[] } | null>(null);
  const [mine, setMine] = useState<MarketOrder[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([ask('balances'), ask('accounts')])
      .then(([bal, acc]) => {
        setBalances(bal);
        setAccounts(acc);
        const tokens = bal.filter((x) => x.token !== '0');
        setA(tokens[0]?.token ?? '0');
        setB(tokens[1]?.token ?? '0');
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const choices: TokenChoice[] = useMemo(
    () => (balances ?? []).map((x) => ({ id: x.ticker || x.token, label: x.ticker || shortHash(x.token, 4), token: x.token, decimals: x.decimals })),
    [balances],
  );
  const ca = choices.find((c) => c.token === a);
  const cb = choices.find((c) => c.token === b);

  const load = useCallback(async () => {
    if (!ca || !cb || ca.token === cb.token) {
      return;
    }
    setError(null);
    try {
      const [bk, my] = await Promise.all([ask('marketOrders', { market: `${ca.id}/${cb.id}` }), ask('myOrders', { tokens: [ca.id, cb.id] })]);
      setBook(bk);
      setMine(my.filter((o) => [o.give.token, o.want.token].includes(ca.token) && [o.give.token, o.want.token].includes(cb.token)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ca, cb]);

  useEffect(() => {
    setBook(null);
    load();
  }, [load]);

  if (!balances) {
    return (
      <>
        <Header title={t.market} onBack={() => go({ name: 'home' })} />
        <div className="page">{error ? <ErrorBox error={error} /> : <Spinner />}</div>
      </>
    );
  }

  const myGenesis = status.session?.genesis;
  const row = (o: MarketOrder) => {
    const own = o.owner === myGenesis;
    return (
      <li key={o.txid}>
        <div className="grow">
          <div className="name">
            {formatAmount(amountOfA(o, a), ca?.decimals)} {ca?.label}
          </div>
          <div className="small muted">
            {t.priceEachShort.replace('{price}', `${formatAmount(priceOf(o, a), 8)} ${cb?.label ?? ''}`)} · {formatTime(o.timestamp)}
          </div>
        </div>
        {own ? (
          <span className="pill">{t.yours}</span>
        ) : (
          <button className="btn tiny" onClick={() => setAction({ kind: 'fill', order: o })}>
            {o.type === 'ask' ? t.buy : t.sell}
          </button>
        )}
      </li>
    );
  };

  return (
    <>
      <Header title={t.market} onBack={() => go({ name: 'home' })} />
      <div className="page">
        <div className="row">
          <select aria-label={t.marketToken} value={a} onChange={(e) => setA(e.target.value)}>
            {choices.map((c) => (
              <option key={c.token} value={c.token}>
                {c.label}
              </option>
            ))}
          </select>
          <select aria-label={t.marketPrice} value={b} onChange={(e) => setB(e.target.value)}>
            {choices.map((c) => (
              <option key={c.token} value={c.token}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {a === b && <div className="notice warn small">{t.samePair}</div>}
        <ErrorBox error={error} />
        {done && <div className="notice ok">{done}</div>}

        {action ? (
          <OrderAction
            action={action}
            a={ca!}
            b={cb!}
            accounts={accounts}
            onClose={(msg) => {
              setAction(null);
              if (msg) {
                setDone(msg);
                load();
              }
            }}
          />
        ) : (
          a !== b && (
            <>
              <button className="btn primary block" onClick={() => setAction({ kind: 'new' })}>
                {t.newOrder}
              </button>
              {!book ? (
                <Spinner />
              ) : (
                <>
                  <h2>
                    {t.asks} <span className="small muted">({t.asksHint})</span>
                  </h2>
                  {book.asks.length ? <ul className="list">{book.asks.map(row)}</ul> : <p className="empty">{t.noOrders}</p>}
                  <h2>
                    {t.bids} <span className="small muted">({t.bidsHint})</span>
                  </h2>
                  {book.bids.length ? <ul className="list">{book.bids.map(row)}</ul> : <p className="empty">{t.noOrders}</p>}
                  <h2>{t.myOrders}</h2>
                  {mine.length ? (
                    <ul className="list">
                      {mine.map((o) => (
                        <li key={o.txid}>
                          <div className="grow">
                            <div className="name">
                              {o.give.token === a ? t.sell : t.buy} {formatAmount(amountOfA(o, a), ca?.decimals)} {ca?.label}
                            </div>
                            <div className="small muted">
                              {t.priceEachShort.replace('{price}', `${formatAmount(priceOf(o, a), 8)} ${cb?.label ?? ''}`)} · {formatTime(o.timestamp)}
                            </div>
                          </div>
                          <button className="btn tiny" onClick={() => setAction({ kind: 'cancel', order: o })}>
                            {t.cancelOrder}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">{t.noOrders}</p>
                  )}
                </>
              )}
            </>
          )
        )}
      </div>
    </>
  );
}

export function OrderAction({
  action,
  a,
  b,
  accounts,
  onClose,
  preset,
  closeLabel,
}: {
  action: Action;
  a: TokenChoice;
  b: TokenChoice;
  accounts: Account[];
  onClose: (done?: string, txid?: string) => void;
  //values a site asked for, shown and not editable
  preset?: OrderPreset;
  closeLabel?: string;
}) {
  const { t } = useApp();
  const [side, setSide] = useState<'ask' | 'bid'>(preset?.side ?? 'ask');
  const [amountText, setAmountText] = useState(preset ? String(preset.amount) : '');
  const [priceText, setPriceText] = useState(preset ? String(preset.price) : '');
  const locked = !!preset;
  const [pin, setPin] = useState('');
  const { busy, error, run } = useAction();

  const accA = pickAccount(accounts, a.token);
  const accB = pickAccount(accounts, b.token);

  let summary: { pay: string; get: string; missing?: string; tooMuch?: boolean } = { pay: '', get: '' };
  let exec: (() => Promise<unknown>) | null = null;

  if (action.kind === 'fill') {
    const o = action.order;
    //filling pays what the owner wants and gets what the owner gives
    const payAcc = pickAccount(accounts, o.want.token);
    const getAcc = pickAccount(accounts, o.give.token);
    summary = {
      pay: `${formatAmount(o.want.amount, 8)} ${o.want.ticker ?? shortHash(o.want.token, 4)}`,
      get: `${formatAmount(o.give.amount, 8)} ${o.give.ticker ?? shortHash(o.give.token, 4)}`,
      missing: !payAcc ? o.want.ticker : !getAcc ? o.give.ticker : undefined,
      tooMuch: !!payAcc && o.want.amount > payAcc.balance,
    };
    if (payAcc && getAcc) {
      exec = () => ask('executeOrder', { txid: o.txid, from: payAcc.address, to: getAcc.address, pin });
    }
  } else if (action.kind === 'cancel') {
    const o = action.order;
    summary = { pay: '', get: `${formatAmount(o.give.amount, 8)} ${o.give.ticker ?? ''}` };
    exec = () => ask('cancelOrder', { txid: o.txid, pin });
  } else {
    const amount = parseAmount(amountText, a.decimals);
    const price = parseAmount(priceText, 8);
    if (amount !== null && price !== null) {
      const total = amount * price;
      summary =
        side === 'ask'
          ? { pay: `${formatAmount(amount, a.decimals)} ${a.label}`, get: `${formatAmount(total, b.decimals)} ${b.label}`, tooMuch: !!accA && amount > accA.balance }
          : { pay: `${formatAmount(total, b.decimals)} ${b.label}`, get: `${formatAmount(amount, a.decimals)} ${a.label}`, tooMuch: !!accB && total > accB.balance };
      summary.missing = !accA ? a.label : !accB ? b.label : undefined;
      if (accA && accB) {
        //an ask gives A, a bid gives B; the core takes the amount in the token that is given
        exec = () =>
          ask('createOrder', {
            order: side,
            market: `${a.id}/${b.id}`,
            amount: side === 'ask' ? amount : Number(total.toFixed(b.decimals)),
            price,
            from: side === 'ask' ? accA.address : accB.address,
            to: side === 'ask' ? accB.address : accA.address,
            pin,
          });
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!exec) {
      return;
    }
    const call = exec;
    await run(async () => {
      const r = (await call()) as { txid?: string } | undefined;
      setPin('');
      onClose(action.kind === 'fill' ? t.orderFilled : action.kind === 'cancel' ? t.orderCancelled : t.orderPlaced, r?.txid);
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{action.kind === 'fill' ? t.fillOrder : action.kind === 'cancel' ? t.cancelOrder : t.newOrder}</h2>
      {action.kind === 'new' && (
        <>
          <div className="tabs">
            <button type="button" className={side === 'ask' ? 'active' : ''} disabled={locked} onClick={() => setSide('ask')}>
              {t.sell} {a.label}
            </button>
            <button type="button" className={side === 'bid' ? 'active' : ''} disabled={locked} onClick={() => setSide('bid')}>
              {t.buy} {a.label}
            </button>
          </div>
          <Field label={`${t.amount} (${a.label})`}>
            <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" autoComplete="off" readOnly={locked} />
          </Field>
          <Field label={`${t.priceEach} (${b.label})`}>
            <input value={priceText} onChange={(e) => setPriceText(e.target.value)} inputMode="decimal" autoComplete="off" readOnly={locked} />
          </Field>
        </>
      )}
      {(summary.pay || summary.get) && (
        <dl className="review">
          {summary.pay && (
            <>
              <dt>{t.youPay}</dt>
              <dd>{summary.pay}</dd>
            </>
          )}
          <dt>{action.kind === 'cancel' ? t.youGetBack : t.youGet}</dt>
          <dd>{summary.get}</dd>
        </dl>
      )}
      {summary.missing && <div className="notice error small">{t.needAccount.replace('{token}', summary.missing)}</div>}
      {summary.tooMuch && <div className="notice error small">{t.tooMuch}</div>}
      <Field label={t.confirmWithPin}>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
      </Field>
      <ErrorBox error={error} />
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => onClose()}>
          {closeLabel ?? t.cancel}
        </button>
        <button className="btn primary" disabled={busy || !exec || !pin || summary.tooMuch}>
          {busy ? t.sending : t.confirm}
        </button>
      </div>
    </form>
  );
}
