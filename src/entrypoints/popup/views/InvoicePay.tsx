import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, formatTime, shortHash } from '../../../lib/format';
import type { Account, Balance, Invoice } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Spinner, Ticker } from '../components';

//invoice details with pay, used in the popup and in the approval window of a site
export function InvoicePay({
  address,
  onPaid,
  onRejected,
  onCancelled,
  extra,
  onBusy,
}: {
  address: string;
  onPaid: (txid: string) => void;
  onRejected?: () => void;
  //only the popup offers cancel for invoices this profile sent
  onCancelled?: () => void;
  extra?: (busy: boolean) => React.ReactNode;
  //lets the screen around it hide its back button while paying
  onBusy?: (busy: boolean) => void;
}) {
  const { t, status } = useApp();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [from, setFrom] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, setError, run } = useAction();
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);

  useEffect(() => {
    Promise.all([ask('invoice', { address }), ask('accounts'), ask('balances')])
      .then(([i, list, b]) => {
        setInv(i);
        setBalances(b);
        const usable = list.filter((a) => a.type !== 'TRUST' && a.token === i.token).sort((x, y) => y.balance - x.balance);
        setAccounts(usable);
        if (usable.length) {
          setFrom(usable[0]!.address);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [address]);

  if (!inv) {
    return error ? <ErrorBox error={error} /> : <Spinner />;
  }

  const b = balances.find((x) => x.token === inv.token);
  const decimals = b?.decimals ?? 6;
  const ticker = b?.ticker ?? (inv.token === '0' ? 'NXS' : undefined);
  const account = accounts.find((a) => a.address === from);
  const tooMuch = !!account && inv.amount > account.balance;
  const open = inv.status === 'OUTSTANDING';
  //invoices this profile sent come in the same outstanding list, they can be cancelled, not paid
  const me = status.session?.genesis.toLowerCase();
  const toMe = !!me && inv.recipient?.toLowerCase() === me;
  //an invoice in transfer has 00 as owner type, the issuer is a user of this network
  const issuer = inv.issuer?.startsWith('00') && status.session ? status.session.genesis.slice(0, 2) + inv.issuer.slice(2) : inv.issuer;
  const mine = !!me && !toMe && issuer?.toLowerCase() === me;
  const payable = open && toMe;

  async function act(action: 'pay' | 'reject' | 'cancel') {
    await run(async () => {
      if (action === 'cancel') {
        await ask('cancelInvoice', { address, pin });
        setPin('');
        onCancelled?.();
      } else if (action === 'pay') {
        const r = await ask('payInvoice', { address, from, pin });
        setPin('');
        onPaid(r.txid);
      } else {
        await ask('rejectInvoice', { address, pin });
        setPin('');
        onRejected?.();
      }
    });
  }

  return (
    <form
      className="page"
      onSubmit={(e) => {
        e.preventDefault();
        act(mine ? 'cancel' : 'pay');
      }}
    >
      <dl className="review">
        <dt>{t.payTo}</dt>
        <dd className="mono break">{inv.to || inv.account}</dd>
        <dt>{t.issuer}</dt>
        <dd className="mono small">{shortHash(issuer, 8)}</dd>
        {inv.created && (
          <>
            <dt>{t.date}</dt>
            <dd>{formatTime(inv.created)}</dd>
          </>
        )}
        {inv.reference && (
          <>
            <dt>{t.invNote}</dt>
            <dd className="break">{inv.reference}</dd>
          </>
        )}
        <dt>{t.status}</dt>
        <dd>{inv.status === 'PAID' ? t.statusPaid : inv.status === 'CANCELLED' ? t.statusCancelled : inv.status === 'OUTSTANDING' ? t.statusOpen : inv.status}</dd>
      </dl>
      <ul className="list">
        {inv.items.map((it, i) => (
          <li key={i}>
            <div className="grow">
              <div className="name">{it.description || '-'}</div>
              <div className="small muted">
                {it.units} x {formatAmount(it.amount, decimals)}
              </div>
            </div>
            <div className="amount">{formatAmount(it.amount * it.units, decimals)}</div>
          </li>
        ))}
      </ul>
      <div className="review-total">
        <span>{t.total}</span>
        <strong>
          {formatAmount(inv.amount, decimals)} <Ticker ticker={ticker} token={inv.token} />
        </strong>
      </div>
      {mine && <div className="notice info small">{t.invYours.replace('{who}', shortHash(inv.recipient, 8))}</div>}
      {mine && open && onCancelled && (
        <Field label={t.confirmWithPin}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
        </Field>
      )}
      {payable && accounts.length === 0 && <div className="notice error">{t.noMatchingAccount}</div>}
      {payable && accounts.length > 0 && (
        <>
          <Field label={t.payFrom} error={tooMuch ? t.tooMuch : null}>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name || shortHash(a.address)} - {formatAmount(a.balance, decimals)} {a.ticker || ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.confirmWithPin}>
            <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
          </Field>
        </>
      )}
      <ErrorBox error={error} />
      <div className="row">
        {extra?.(busy)}
        {mine && open && onCancelled && (
          <button className="btn" disabled={busy || !pin}>
            {busy ? t.credSaving : t.cancelInvoice}
          </button>
        )}
        {payable && onRejected && (
          <button type="button" className="btn" disabled={busy || !pin} onClick={() => act('reject')}>
            {t.rejectInvoice}
          </button>
        )}
        {payable && (
          <button className="btn primary" disabled={busy || !pin || !account || tooMuch}>
            {busy ? t.sending : t.payInvoice}
          </button>
        )}
      </div>
    </form>
  );
}
