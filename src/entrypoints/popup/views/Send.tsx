import { defaultExpiry } from '../../../lib/claims';
import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, isRecipient, isReference, parseAmount, shortHash } from '../../../lib/format';
import type { Account, Balance } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { findContact, listContacts, type Contact } from '../../../lib/contacts';
import { CopyButton, ErrorBox, Field, Header, Spinner, Ticker } from '../components';

type Step = 'form' | 'review' | 'done';

//seconds the receiver has to claim; the core's default is 7 days, 0 never expires (and can never be taken back)
const expiryChoices = [600, 3600, 86400, 604800, 0];

export function Send({ from: initialFrom, to: initialTo }: { from?: string; to?: string }) {
  const { t, go } = useApp();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [decimals, setDecimals] = useState<Record<string, number>>({});
  const [unconfirmed, setUnconfirmed] = useState<Record<string, number>>({});
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const [amountText, setAmountText] = useState('');
  const [reference, setReference] = useState('');
  const [expires, setExpires] = useState(defaultExpiry);
  const expiryText = (s: number) => (s === 0 ? t.expiresNever : s === defaultExpiry ? t.expires7d : s === 86400 ? t.expires1d : s === 3600 ? t.expires1h : t.expires10m);
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [touched, setTouched] = useState(false);
  const { busy, error, setError, run } = useAction();
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    listContacts().then(setContacts);
  }, []);
  const [txid, setTxid] = useState('');

  useEffect(() => {
    Promise.all([ask('accounts'), ask('balances')])
      .then(([list, balances]: [Account[], Balance[]]) => {
        const spendable = list.filter((a) => a.type !== 'TRUST');
        setAccounts(spendable);
        setDecimals(Object.fromEntries(balances.map((b) => [b.token, b.decimals])));
        setUnconfirmed(Object.fromEntries(balances.map((b) => [b.token, b.unconfirmed])));
        if (!initialFrom && spendable.length) {
          setFrom((spendable.find((a) => a.token === '0') ?? spendable[0]!).address);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [initialFrom]);

  if (!accounts) {
    return (
      <>
        <Header title={t.sendTitle} onBack={() => go({ name: 'home' })} />
        <div className="page">{error ? <ErrorBox error={error} /> : <Spinner />}</div>
      </>
    );
  }

  const account = accounts.find((a) => a.address === from);
  const dec = account ? (decimals[account.token] ?? 6) : 6;
  const amount = parseAmount(amountText, dec);
  const toTrim = to.trim();

  const errors = {
    to: !isRecipient(toTrim) ? t.badRecipient : account && (toTrim === account.address || toTrim === account.name) ? t.sameAccount : null,
    amount: amount === null ? t.badAmount : account && amount > account.balance ? t.tooMuch : null,
    reference: !isReference(reference) ? t.badReference : null,
  };
  const valid = !!account && !errors.to && !errors.amount && !errors.reference;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account || amount === null) {
      return;
    }
    await run(async () => {
      const r = await ask('send', { from: account.address, to: toTrim, amount, reference: reference.trim() || undefined, expires, pin });
      setTxid(r.txid);
      setPin('');
      setStep('done');
    });
  }

  if (step === 'done') {
    return (
      <>
        <Header title={t.sentTitle} />
        <div className="page">
          <div className="notice ok">{t.sentText}</div>
          <Field label={t.txid}>
            <div className="mono small break">{txid}</div>
          </Field>
          <div className="row">
            <CopyButton value={txid} label={t.copy} done={t.copied} />
          </div>
          <button className="btn primary block" onClick={() => go({ name: 'home' })}>
            {t.close}
          </button>
        </div>
      </>
    );
  }

  if (step === 'review' && account && amount !== null) {
    return (
      <>
        <Header title={t.reviewTitle} onBack={busy ? undefined : () => setStep('form')} />
        <form className="page" onSubmit={submit}>
          <dl className="review">
            <dt>{t.from}</dt>
            <dd>
              {account.name || shortHash(account.address)} <span className="muted mono small">{shortHash(account.address, 6)}</span>
            </dd>
            <dt>{t.to}</dt>
            <dd className="mono break">
              {findContact(contacts, toTrim) && <div className="contact-name">{findContact(contacts, toTrim)!.name}</div>}
              {toTrim}
            </dd>
            <dt>{t.amount}</dt>
            <dd className="big">
              {formatAmount(amount, dec)} <Ticker ticker={account.ticker} token={account.token} />
            </dd>
            <dt>{t.expiresLabel}</dt>
            <dd>{expiryText(expires)}</dd>
            {reference.trim() && (
              <>
                <dt>{t.reference}</dt>
                <dd>{reference.trim()}</dd>
              </>
            )}
          </dl>
          <Field label={t.confirmWithPin}>
            <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required autoFocus />
          </Field>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy || !pin}>
            {busy ? t.sending : t.sendNow}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <Header title={t.sendTitle} onBack={() => go({ name: 'home' })} />
      <form
        className="page"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (valid) {
            setStep('review');
          }
        }}
      >
        <Field label={t.from}>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.address} value={a.address}>
                {a.name || shortHash(a.address)} - {formatAmount(a.balance, decimals[a.token] ?? 6)} {a.ticker || shortHash(a.token, 4)}
              </option>
            ))}
          </select>
        </Field>
        {account && (unconfirmed[account.token] ?? 0) > 0 && <div className="notice warn small">{t.waitConfirm}</div>}
        {contacts.length > 0 && (
          <Field label={t.pickContact}>
            <select value={contacts.find((c) => c.to === to)?.id ?? ''} onChange={(e) => setTo(contacts.find((c) => c.id === e.target.value)?.to ?? to)}>
              <option value="">-</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t.to} hint={t.toHint} error={touched ? errors.to : null}>
          <input value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} autoComplete="off" autoFocus />
        </Field>
        <Field label={t.amount} error={touched ? errors.amount : null}>
          <div className="input-row">
            <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" autoComplete="off" />
            <button type="button" className="btn small" onClick={() => account && setAmountText(String(account.balance))}>
              {t.max}
            </button>
          </div>
        </Field>
        <Field label={t.expiresLabel} hint={t.expiresHint}>
          <select value={expires} onChange={(e) => setExpires(Number(e.target.value))}>
            {expiryChoices.map((s) => (
              <option key={s} value={s}>
                {expiryText(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.reference} hint={t.referenceHint} error={touched ? errors.reference : null}>
          <input value={reference} onChange={(e) => setReference(e.target.value)} inputMode="numeric" autoComplete="off" />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={!account}>
          {t.review}
        </button>
      </form>
    </>
  );
}
