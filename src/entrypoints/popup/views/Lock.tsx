import { useState } from 'react';
import { ask, RequestError } from '../../../lib/messages';
import { deriveKey, signer, toHex } from '../../../lib/keys';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Header } from '../components';

const needPasswordCode = -1021;

//unlock with the PIN; cores without sessions/validate/pin also need the password, checked here against
//the auth key of the crypto register like a sign-in
export function Lock({ banner }: { banner?: React.ReactNode }) {
  const { t, status, refresh } = useApp();
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const { busy, error, run } = useAction();

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (!needPassword) {
        try {
          await ask('unlock', { pin });
        } catch (err) {
          //no error shown, the form asks for the password next
          if (err instanceof RequestError && err.code === needPasswordCode) {
            setNeedPassword(true);
            return;
          }
          throw err;
        }
      } else {
        const reg = await ask('cryptoRegister');
        if (!reg?.auth || /^0+$/.test(reg.auth)) {
          throw new Error(t.noAuthKey);
        }
        const challenge = await ask('unlockChallenge');
        const key = await deriveKey(status.session!.username, password, pin, 'auth');
        try {
          if (key.hash.toLowerCase() !== reg.auth.toLowerCase()) {
            throw new Error(t.wrongSignCredentials);
          }
          //proves to the background that this page has the auth key, not only that it says so
          const signature = signer.sign(new TextEncoder().encode('nexus-wallet-unlock:' + challenge), key.privateKey, { format: 'der', lowS: false });
          await ask('unlockVerified', { publicKey: toHex(key.publicKey), signature: toHex(signature) });
        } finally {
          key.privateKey.fill(0);
        }
      }
      setPin('');
      setPassword('');
      await refresh();
    });
  }

  return (
    <>
      <Header hero title={t.locked} />
      {banner}
      <form className="page" onSubmit={unlock}>
        <div className="lock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40">
            <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>
        <p className="muted center">
          {status.session?.username} · {t.lockedText}
        </p>
        {needPassword && (
          <>
            <p className="small muted">{t.lockNeedsPassword}</p>
            <Field label={t.password}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
            </Field>
          </>
        )}
        <Field label={t.pin}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required autoFocus={!needPassword} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy || !pin || (needPassword && !password)}>
          {busy ? t.loading : t.unlock}
        </button>
      </form>
    </>
  );
}
