import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, parseAmount, shortHash } from '../../../lib/format';
import type { Account, Balance } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { CopyButton, ErrorBox, Field, Header, Spinner } from '../components';

const maxItems = 10;
const usernamePattern = /^[^\s:]{2,}$/;
const genesisPattern = /^[0-9a-f]{64}$/i;

interface Row {
  description: string;
  price: string;
  units: string;
}

//invoices/create/invoice: the payer pays the total into one of our accounts
export function NewInvoice() {
  const { t, go } = useApp();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [to, setTo] = useState('');
  const [payer, setPayer] = useState('');
  const [rows, setRows] = useState<Row[]>([{ description: '', price: '', units: '1' }]);
  const [reference, setReference] = useState('');
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<{ address: string } | null>(null);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    Promise.all([ask('accounts'), ask('balances')])
      .then(([list, b]) => {
        const usable = list.filter((a) => a.type !== 'TRUST');
        setAccounts(usable);
        setBalances(b);
        if (usable.length) {
          setTo(usable[0]!.address);
        }
      })
      .catch((e) => {
        setAccounts([]);
        setError((e as Error).message);
      });
  }, []);

  const account = accounts?.find((a) => a.address === to);
  //NXS has 6, a token only what its balance entry says
  const decimals = account?.token === '0' ? 6 : balances.find((b) => b.token === account?.token)?.decimals;
  const ticker = account?.ticker || (account?.token === '0' ? 'NXS' : shortHash(account?.token, 4));
  const parsed = rows.map((r) => ({ description: r.description.trim(), amount: decimals === undefined ? null : parseAmount(r.price, decimals), units: /^\d+$/.test(r.units.trim()) ? Number(r.units) : 0 }));
  const total = parsed.reduce((s, r) => s + (r.amount ?? 0) * r.units, 0);
  const errors = {
    payer: !usernamePattern.test(payer.trim()) && !genesisPattern.test(payer.trim()) ? t.invPayerBad : null,
    items: parsed.some((r) => !r.description || r.amount === null || r.units < 1) ? t.invItemsBad : null,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!account || decimals === undefined || Object.values(errors).some(Boolean)) {
      return;
    }
    await run(async () => {
      const items = parsed.map((r) => ({ description: r.description, amount: r.amount!, units: r.units }));
      const r = await ask('createInvoice', { to: account.address, recipient: payer.trim(), items, reference: reference.trim() || undefined, pin });
      setPin('');
      setResult(r);
    });
  }

  const setRow = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  if (result) {
    return (
      <>
        <Header title={t.invTitle} />
        <div className="page">
          <div className="notice ok">{t.invSent}</div>
          <div className="row-between">
            <span className="mono small break">{shortHash(result.address, 10)}</span>
            <CopyButton value={result.address} label={t.copy} done={t.copied} />
          </div>
          <button className="btn primary block" onClick={() => go({ name: 'home' })}>
            {t.close}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={t.invTitle} onBack={busy ? undefined : () => go({ name: 'home' })} />
      <form className="page" onSubmit={submit}>
        {!accounts && <Spinner />}
        {accounts && accounts.length === 0 && <div className="notice error">{t.invNoAccount}</div>}
        {accounts && accounts.length > 0 && (
          <>
            <p className="small muted">{t.invIntro}</p>
            <Field label={t.invPayer} error={touched ? errors.payer : null}>
              <input value={payer} onChange={(e) => setPayer(e.target.value)} spellCheck={false} autoComplete="off" disabled={busy} autoFocus />
            </Field>
            <Field label={t.invTo}>
              <select value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
                {accounts.map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.name || shortHash(a.address)} ({a.ticker || (a.token === '0' ? 'NXS' : shortHash(a.token, 4))})
                  </option>
                ))}
              </select>
            </Field>
            <section className="card">
              <h2>{t.invItems}</h2>
              {rows.map((r, i) => (
                <div className="input-row invoice-row" key={i}>
                  <input aria-label={`${t.invDesc} ${i + 1}`} placeholder={t.invDesc} value={r.description} onChange={(e) => setRow(i, 'description', e.target.value)} disabled={busy} />
                  <input aria-label={`${t.invPrice} ${i + 1}`} placeholder={t.invPrice} value={r.price} onChange={(e) => setRow(i, 'price', e.target.value)} inputMode="decimal" disabled={busy} />
                  <input aria-label={`${t.invUnits} ${i + 1}`} placeholder={t.invUnits} value={r.units} onChange={(e) => setRow(i, 'units', e.target.value)} inputMode="numeric" disabled={busy} />
                  {rows.length > 1 && (
                    <button type="button" className="btn tiny ghost" aria-label={`${t.remove} ${i + 1}`} disabled={busy} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      x
                    </button>
                  )}
                </div>
              ))}
              {rows.length < maxItems && (
                <button type="button" className="btn small" disabled={busy} onClick={() => setRows([...rows, { description: '', price: '', units: '1' }])}>
                  {t.invAddItem}
                </button>
              )}
              {touched && errors.items && <span className="field-error">{errors.items}</span>}
              <div className="review-total">
                <span>{t.total}</span>
                <strong>
                  {formatAmount(total, decimals)} {ticker}
                </strong>
              </div>
            </section>
            <Field label={t.invReference}>
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} autoComplete="off" disabled={busy} />
            </Field>
            <Field label={t.confirmWithPin}>
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" disabled={busy} />
            </Field>
            {decimals === undefined && <div className="notice error small">{t.invNoDecimals}</div>}
            <ErrorBox error={error} />
            <button className="btn primary block" disabled={busy || !pin || decimals === undefined}>
              {busy ? t.invSending : t.invSend}
            </button>
          </>
        )}
        {accounts && accounts.length === 0 && <ErrorBox error={error} />}
      </form>
    </>
  );
}
