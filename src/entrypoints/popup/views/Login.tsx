import { useState } from 'react';
import { ask } from '../../../lib/messages';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Header } from '../components';
import { NetworkBadge } from './Home';
import { createLocalProfile } from '../../../lib/local-profile';

//core rules for new profiles (src/TAO/API/commands/profiles/create.cpp)
const minUsername = 2;
export const minPassword = 8;
export const minPin = 4;
//the core takes any phrase, a short one is easy to guess
export const minRecovery = 40;

export function RemoteNodeWarning() {
  const { t, status } = useApp();
  //signing in this browser: the node never gets the login
  if (!status.remote || status.localMode) {
    return null;
  }
  return (
    <div className={`notice small ${status.sharedLogin ? 'error' : 'warn'}`}>
      <div>{status.sharedLogin ? t.sharedLoginWarning : t.remoteNodeWarning}</div>
      <SignHereButton />
    </div>
  );
}

//same node, same API login, but the login stays in this browser from now on
function SignHereButton() {
  const { t, refresh } = useApp();
  const { busy, error, run } = useAction();
  return (
    <>
      <button
        type="button"
        className="btn tiny"
        disabled={busy}
        onClick={() => run(async () => {
          await ask('signHere');
          await refresh();
        })}
      >
        {t.signHereInstead}
      </button>
      <ErrorBox error={error} />
    </>
  );
}

export function Login() {
  const { t, refresh, go, status } = useApp();
  const [mode, setMode] = useState<'login' | 'create' | 'recover'>('login');
  const [recovery, setRecovery] = useState('');
  const [recovered, setRecovered] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  //one action for both modes, only one form is shown at a time
  const { busy, error, setError, run } = useAction();
  const [created, setCreated] = useState<string | null>(null);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await ask('login', { username: username.trim(), password, pin });
      setPassword('');
      setPin('');
      await refresh();
    });
  }

  const createErrors = {
    username: username.trim().length < minUsername ? t.usernameShort : null,
    password: password.length < minPassword ? t.passwordShort : null,
    password2: password2 !== password ? t.passwordsDiffer : null,
    pin: pin.length < minPin ? t.pinShort : null,
    pin2: pin2 !== pin ? t.pinsDiffer : null,
  };
  const [touched, setTouched] = useState(false);
  //proof of work tries while a new profile is made here
  const [progress, setProgress] = useState<number | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(createErrors).some(Boolean)) {
      return;
    }
    await run(async () => {
      if (status.localMode) {
        setProgress(0);
        try {
          await createLocalProfile(username.trim(), password, pin, setProgress);
        } finally {
          setProgress(null);
        }
      } else {
        await ask('createProfile', { username: username.trim(), password, pin });
      }
      setCreated(username.trim());
      setPassword2('');
      setPin2('');
      setMode('login');
    });
  }

  async function recover(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.values(createErrors).some(Boolean) || !recovery.trim()) {
      return;
    }
    await run(async () => {
      await ask('recoverProfile', { username: username.trim(), recovery, password, pin });
      setRecovered(username.trim());
      setCreated(null);
      setRecovery('');
      setPassword('');
      setPassword2('');
      setPin('');
      setPin2('');
      setTouched(false);
      setMode('login');
    });
  }

  const switchTo = (m: 'login' | 'create' | 'recover') => {
    setError(null);
    setTouched(false);
    setRecovery('');
    setPassword('');
    setPassword2('');
    setPin('');
    setPin2('');
    setMode(m);
  };

  if (mode === 'recover') {
    return (
      <>
        <Header title={t.recoverTitle} onBack={busy ? undefined : () => switchTo('login')} />
        <form className="page" onSubmit={recover}>
          {status.node && <NetworkBadge />}
          <RemoteNodeWarning />
          <p className="small muted">{t.recoverIntro}</p>
          <Field label={t.username} error={touched ? createErrors.username : null}>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoFocus disabled={busy} />
          </Field>
          <Field label={t.recoverPhrase} error={touched && !recovery.trim() ? t.recMissing : null}>
            <textarea value={recovery} onChange={(e) => setRecovery(e.target.value)} rows={2} spellCheck={false} autoComplete="off" disabled={busy} />
          </Field>
          <Field label={t.newPassword} hint={t.passwordHint} error={touched ? createErrors.password : null}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={busy} />
          </Field>
          <Field label={t.newPasswordAgain} error={touched ? createErrors.password2 : null}>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" disabled={busy} />
          </Field>
          <Field label={t.newPin} hint={t.pinHint} error={touched ? createErrors.pin : null}>
            <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
          <Field label={t.newPinAgain} error={touched ? createErrors.pin2 : null}>
            <input type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy || !!status.sharedLogin}>
            {busy ? t.recovering : t.recoverIt}
          </button>
        </form>
      </>
    );
  }

  if (mode === 'create') {
    return (
      <>
        <Header title={t.createTitle} onBack={busy ? undefined : () => switchTo('login')} />
        <form className="page" onSubmit={create}>
          {status.node && <NetworkBadge />}
          <RemoteNodeWarning />
          <p className="small muted">{t.createIntro}</p>
          <Field label={t.username} error={touched ? createErrors.username : null}>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} autoFocus />
          </Field>
          <Field label={t.password} hint={t.passwordHint} error={touched ? createErrors.password : null}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label={t.passwordAgain} error={touched ? createErrors.password2 : null}>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label={t.pin} hint={t.pinHint} error={touched ? createErrors.pin : null}>
            <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={t.pinAgain} error={touched ? createErrors.pin2 : null}>
            <input type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} autoComplete="off" />
          </Field>
          <div className="notice warn small">{t.createWarning}</div>
          {status.localMode && <p className="small muted">{t.localCreateNote}</p>}
          {progress !== null && <div className="notice info small">{t.localCreateWorking.replace('{n}', progress.toLocaleString())}</div>}
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy || !!status.sharedLogin}>
            {busy ? t.creating : t.createAccount}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <Header
        hero
        title={t.loginTitle}
        right={
          status.locked ? undefined : (
            <button className="btn small ghost" type="button" onClick={() => go({ name: 'node' })}>
              {t.nodeSettings}
            </button>
          )
        }
      />
      <form className="page" onSubmit={login}>
        {status.node && <NetworkBadge />}
        <RemoteNodeWarning />
        {status.nodeChange && (
          <div className="notice warn small">
            {t.nodeChanged
              .replace('{date}', new Date(status.nodeChange.at * 1000).toLocaleString())
              .replace('{from}', status.nodeChange.from)
              .replace('{to}', status.nodeChange.to)}
          </div>
        )}
        {recovered ? (
          <div className="notice ok small">{t.recoveredText.replace('{user}', recovered)}</div>
        ) : created ? (
          <div className="notice ok small">{t.createdText.replace('{user}', created)}</div>
        ) : (
          <p className="muted">{t.loginIntro}</p>
        )}
        <Field label={t.username}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} required autoFocus />
        </Field>
        <Field label={t.password}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Field label={t.pin}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy || !!status.sharedLogin}>
          {busy ? t.loggingIn : t.login}
        </button>
        <button className="btn ghost block" type="button" disabled={busy} onClick={() => switchTo('create')}>
          {t.createAccount}
        </button>
        {status.localMode && <p className="small muted">{t.localLoginNote}</p>}
        <button className="btn ghost small block" type="button" disabled={busy} onClick={() => switchTo('recover')}>
          {t.recoverLink}
        </button>
      </form>
    </>
  );
}
