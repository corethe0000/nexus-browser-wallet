import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, isAddress, shortHash } from '../../../lib/format';
import { assetData, globalNameFee, nameFee, objectFee, tokenFee } from '../../../lib/tritium';
import type { Account, Asset, Balance } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { CopyButton, ErrorBox, Field, Header } from '../components';

export type CreateKind = 'account' | 'token' | 'name' | 'asset';

//the core's limits: token decimals 0 to 8
const maxDecimals = 8;
const maxFields = 10;
const fieldKey = /^[a-z][a-z0-9_]{0,31}$/;

export function Create({ kind: initial }: { kind?: CreateKind }) {
  const { t, go, status } = useApp();
  const [kind, setKind] = useState<CreateKind>(initial ?? 'account');
  const [name, setName] = useState('');
  const [token, setToken] = useState('0');
  const [supply, setSupply] = useState('');
  const [decimals, setDecimals] = useState('2');
  const [register, setRegister] = useState('');
  const [global, setGlobal] = useState(false);
  const [fields, setFields] = useState<{ k: string; v: string }[]>([{ k: 'title', v: '' }]);
  const [pin, setPin] = useState('');
  const [tokens, setTokens] = useState<Balance[]>([]);
  //own registers a name can point to
  const [targets, setTargets] = useState<{ address: string; label: string }[]>([]);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<{ txid: string; address: string } | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    ask('balances').then(setTokens, () => {});
    Promise.all([ask('accounts').catch(() => [] as Account[]), ask('assets').catch(() => [] as Asset[])]).then(([acc, ast]) =>
      setTargets([...acc.map((a) => ({ address: a.address, label: a.name || a.type })), ...ast.map((a) => ({ address: a.address, label: a.name || 'asset' }))]),
    );
  }, []);

  const supplyN = /^\d{1,19}$/.test(supply.trim()) ? Number(supply.trim()) : NaN;
  const decimalsN = /^\d$/.test(decimals.trim()) ? Number(decimals.trim()) : NaN;
  const errors: Record<string, string | null> = {
    name: !name.trim() || name.trim().startsWith(':') || /\s/.test(name.trim()) ? t.createNameBad : null,
    supply: kind === 'token' && !(Number.isFinite(supplyN) && supplyN > 0) ? t.badAmount : null,
    decimals: kind === 'token' && !(Number.isInteger(decimalsN) && decimalsN >= 0 && decimalsN <= maxDecimals) ? t.decimalsBad : null,
    register: kind === 'name' && !isAddress(register.trim()) ? t.nameTargetBad : null,
    fields: kind === 'asset' && (fields.filter((f) => f.k.trim()).length === 0 || fields.some((f) => f.k.trim() && (!fieldKey.test(f.k.trim()) || ['name', 'format', 'pin', 'session'].includes(f.k.trim())))) ? t.fieldsBad : null,
  };
  const valid = Object.values(errors).every((e) => !e);

  //what the network charges (TAO/Register/object.cpp), private and hybrid networks charge nothing
  const free = !!status.node?.private || !!(status.node as { hybrid?: boolean } | null)?.hybrid;
  const namedCost = name.trim() ? nameFee : 0n;
  const filled = Object.fromEntries(fields.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v]));
  const cost = free
    ? 0n
    : kind === 'account'
      ? namedCost
      : kind === 'token'
        ? (errors.supply || errors.decimals ? 0n : tokenFee(BigInt(supplyN) * 10n ** BigInt(decimalsN)) + (name.trim() ? globalNameFee : 0n))
        : kind === 'name'
          ? (global ? globalNameFee : nameFee)
          : objectFee(assetData(filled).length) + namedCost;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) {
      return;
    }
    await run(async () => {
      const n = name.trim();
      let r: { txid: string; address: string };
      if (kind === 'account') {
        r = await ask('createRegister', { kind, name: n, token, pin });
      } else if (kind === 'token') {
        r = await ask('createRegister', { kind, name: n, supply: supplyN, decimals: decimalsN, pin });
      } else if (kind === 'name') {
        r = await ask('createRegister', { kind, name: n, register: register.trim(), global, pin });
      } else {
        const f = Object.fromEntries(fields.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v]));
        r = await ask('createRegister', { kind, name: n, fields: f, pin });
      }
      setPin('');
      setResult(r);
    });
  }

  if (result) {
    return (
      <>
        <Header title={t.createDone} />
        <div className="page">
          <div className="notice ok">{t.createDoneText}</div>
          {result.address && (
            <div className="row-between">
              <span className="mono small break">{shortHash(result.address, 10)}</span>
              <CopyButton value={result.address} label={t.copy} done={t.copied} />
            </div>
          )}
          <button className="btn primary block" onClick={() => go({ name: 'home' })}>
            {t.close}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={t.createTitle2} onBack={busy ? undefined : () => go({ name: 'home' })} />
      <form className="page" onSubmit={submit}>
        <div className="tabs">
          {(['account', 'token', 'name', 'asset'] as const).map((k) => (
            <button key={k} type="button" className={kind === k ? 'active' : ''} disabled={busy} onClick={() => setKind(k)}>
              {t[`create_${k}`]}
            </button>
          ))}
        </div>
        <p className="small muted">{t[`createHint_${kind}`]}</p>
        <Field label={t.contactName} error={touched ? errors.name : null}>
          <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoFocus />
        </Field>
        {kind === 'account' && (
          <Field label={t.tokenOfAccount}>
            <select value={token} onChange={(e) => setToken(e.target.value)}>
              <option value="0">NXS</option>
              {tokens
                .filter((b) => b.token !== '0')
                .map((b) => (
                  <option key={b.token} value={b.token}>
                    {b.ticker || shortHash(b.token, 4)}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {kind === 'token' && (
          <>
            <Field label={t.supply} error={touched ? errors.supply : null}>
              <input value={supply} onChange={(e) => setSupply(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label={t.decimals} hint={t.decimalsHint} error={touched ? errors.decimals : null}>
              <input value={decimals} onChange={(e) => setDecimals(e.target.value)} inputMode="numeric" />
            </Field>
          </>
        )}
        {kind === 'name' && (
          <>
            <Field label={t.nameTarget} hint={t.nameTargetHint} error={touched ? errors.register : null}>
              <input value={register} onChange={(e) => setRegister(e.target.value)} spellCheck={false} list="name-targets" />
              <datalist id="name-targets">
                {targets.map((x) => (
                  <option key={x.address} value={x.address}>
                    {x.label}
                  </option>
                ))}
              </datalist>
            </Field>
            <label className="check">
              <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
              <span>{t.globalName}</span>
            </label>
          </>
        )}
        {kind === 'asset' && (
          <section className="card">
            <h2>{t.assetFields}</h2>
            {fields.map((f, i) => (
              <div className="input-row" key={i}>
                <input aria-label={`${t.fieldName} ${i + 1}`} value={f.k} placeholder={t.fieldName} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} spellCheck={false} />
                <input aria-label={`${t.fieldValue} ${i + 1}`} value={f.v} placeholder={t.fieldValue} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
              </div>
            ))}
            {fields.length < maxFields && (
              <button type="button" className="btn small" onClick={() => setFields([...fields, { k: '', v: '' }])}>
                {t.addField}
              </button>
            )}
            {touched && errors.fields && <span className="field-error">{errors.fields}</span>}
          </section>
        )}
        {cost > 0n ? <div className="notice warn small">{t.createCost.replace('{fee}', formatAmount(Number(cost) / 1000000))}</div> : <p className="small muted">{t.createFree}</p>}
        <Field label={t.confirmWithPin}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy || !pin}>
          {busy ? t.creating : t.createIt}
        </button>
      </form>
    </>
  );
}
