import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Header } from '../components';
import { minPassword, minPin, minRecovery } from './Login';

//profiles/update/credentials and profiles/update/recovery
export function Security() {
  const { t, go } = useApp();
  const [credBusy, setCredBusy] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  return (
    <>
      <Header title={t.securityTitle} onBack={credBusy || recBusy ? undefined : () => go({ name: 'settings' })} />
      <div className="page">
        <Credentials onBusy={setCredBusy} />
        <Recovery onBusy={setRecBusy} />
      </div>
    </>
  );
}

function Credentials({ onBusy }: { onBusy: (b: boolean) => void }) {
  const { t } = useApp();
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => onBusy(busy), [busy]);

  const errors = {
    nothing: !password && !newPin ? t.credNothing : null,
    password: password && password.length < minPassword ? t.passwordShort : null,
    password2: password2 !== password ? t.passwordsDiffer : null,
    pin: newPin && newPin.length < minPin ? t.pinShort : null,
    pin2: newPin2 !== newPin ? t.pinsDiffer : null,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setDone(false);
    if (Object.values(errors).some(Boolean)) {
      return;
    }
    await run(async () => {
      await ask('updateCredentials', { pin, newPassword: password || undefined, newPin: newPin || undefined });
      for (const set of [setPin, setPassword, setPassword2, setNewPin, setNewPin2]) {
        set('');
      }
      setTouched(false);
      setDone(true);
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t.credTitle}</h2>
      <p className="small muted">{t.credIntro}</p>
      <Field label={t.newPassword} hint={t.passwordHint} error={touched ? errors.password : null}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={busy} />
      </Field>
      {password && (
        <Field label={t.newPasswordAgain} error={touched ? errors.password2 : null}>
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" disabled={busy} />
        </Field>
      )}
      <Field label={t.newPin} error={touched ? errors.pin : null}>
        <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} autoComplete="off" disabled={busy} />
      </Field>
      {newPin && (
        <Field label={t.newPinAgain} error={touched ? errors.pin2 : null}>
          <input type="password" value={newPin2} onChange={(e) => setNewPin2(e.target.value)} autoComplete="off" disabled={busy} />
        </Field>
      )}
      {touched && errors.nothing && <span className="field-error">{errors.nothing}</span>}
      <Field label={t.currentPin}>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" disabled={busy} />
      </Field>
      <ErrorBox error={error} />
      {done && <div className="notice ok small">{t.credDone}</div>}
      <button className="btn primary block" disabled={busy || !pin}>
        {busy ? t.credSaving : t.credSave}
      </button>
    </form>
  );
}

function Recovery({ onBusy }: { onBusy: (b: boolean) => void }) {
  const { t } = useApp();
  const [pin, setPin] = useState('');
  const [phrase, setPhrase] = useState('');
  const [phrase2, setPhrase2] = useState('');
  const [old, setOld] = useState('');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => onBusy(busy), [busy]);

  const errors = {
    phrase: phrase.trim().length < minRecovery ? t.recShort.replace('{n}', String(minRecovery)) : null,
    phrase2: phrase2 !== phrase ? t.recDiffer : null,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setDone(false);
    if (Object.values(errors).some(Boolean)) {
      return;
    }
    await run(async () => {
      await ask('updateRecovery', { pin, newRecovery: phrase, recovery: old || undefined });
      for (const set of [setPin, setPhrase, setPhrase2, setOld]) {
        set('');
      }
      setTouched(false);
      setDone(true);
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t.recTitle}</h2>
      <p className="small muted">{t.recIntro}</p>
      <Field label={t.recNew} error={touched ? errors.phrase : null}>
        <textarea value={phrase} onChange={(e) => setPhrase(e.target.value)} rows={2} spellCheck={false} autoComplete="off" disabled={busy} />
      </Field>
      <Field label={t.recNewAgain} error={touched ? errors.phrase2 : null}>
        <textarea value={phrase2} onChange={(e) => setPhrase2(e.target.value)} rows={2} spellCheck={false} autoComplete="off" disabled={busy} />
      </Field>
      <Field label={t.recOld}>
        <textarea value={old} onChange={(e) => setOld(e.target.value)} rows={2} spellCheck={false} autoComplete="off" disabled={busy} />
      </Field>
      <Field label={t.currentPin}>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" disabled={busy} />
      </Field>
      <ErrorBox error={error} />
      {done && <div className="notice ok small">{t.recDone}</div>}
      <button className="btn primary block" disabled={busy || !pin}>
        {busy ? t.credSaving : t.recSave}
      </button>
    </form>
  );
}
