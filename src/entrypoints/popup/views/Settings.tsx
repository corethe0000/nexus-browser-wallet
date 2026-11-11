import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { languages, type Lang } from '../../../lib/i18n';
import { formatTime, shortHash } from '../../../lib/format';
import { originLabel } from '../../../lib/dapp';
import type { ConnectedSite } from '../../../lib/sites';
import { defaultLockMinutes, lockChoices } from '../../../lib/lock';
import { loadExplorer, saveExplorer } from '../../../lib/settings';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Header } from '../components';

function LockAndBackup() {
  const { t, refresh, go } = useApp();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    ask('getSettings').then((s) => setMinutes(s.lockMinutes));
  }, []);

  async function exportFile() {
    const data = await ask('exportSettings');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexus-wallet-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function importFile(file: File | undefined) {
    if (!file) {
      return;
    }
    await run(async () => {
      setNote(null);
      try {
        const r = await ask('importSettings', { data: JSON.parse(await file.text()) });
        setNote(r.contacts ? `${t.importDone} ${t.importContacts.replace('{n}', String(r.contacts))}` : t.importDone);
        if (r.node) {
          go({ name: 'node', prefill: r.node });
        }
        ask('getSettings').then((s) => setMinutes(s.lockMinutes));
        await refresh();
      } catch (e) {
        throw e instanceof SyntaxError ? new Error(t.importBadFile) : e;
      }
    });
  }

  return (
    <section className="card">
      <Field label={t.autoLock}>
        <select
          value={minutes ?? defaultLockMinutes}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMinutes(v);
            ask('setLockMinutes', { minutes: v });
          }}
        >
          {lockChoices.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? t.lockNever : t.lockAfter.replace('{min}', String(m))}
            </option>
          ))}
        </select>
      </Field>
      <h2>{t.backup}</h2>
      <p className="small muted">{t.backupText}</p>
      <div className="row">
        <button className="btn" type="button" onClick={exportFile}>
          {t.exportSettings}
        </button>
        <label className="btn file-btn">
          {t.importSettings}
          <input type="file" accept="application/json,.json" onChange={(e) => importFile(e.target.files?.[0])} />
        </label>
      </div>
      {note && <div className="notice ok small">{note}</div>}
      <ErrorBox error={error} />
      <button className="btn block" type="button" onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/popup.html?tab=1') })}>
        {t.openInTab}
      </button>
    </section>
  );
}

function ExplorerSetting() {
  const { t } = useApp();
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    loadExplorer().then(setUrl);
  }, []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await saveExplorer(url);
        setUrl(await loadExplorer());
        setSaved(true);
      }}
    >
      <Field label={t.explorerUrl} hint={saved ? t.saved : t.explorerHint}>
        <div className="input-row">
          <input value={url} onChange={(e) => { setUrl(e.target.value); setSaved(false); }} spellCheck={false} />
          <button className="btn small">{t.save}</button>
        </div>
      </Field>
    </form>
  );
}

function Sites() {
  const { t } = useApp();
  const [sites, setSites] = useState<ConnectedSite[] | null>(null);
  const load = () => ask('sites').then(setSites);
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card">
      <h2>{t.connectedSites}</h2>
      {sites && !sites.length && <p className="small muted">{t.noSites}</p>}
      {sites && sites.length > 0 && (
        <ul className="list">
          {sites.map((s) => (
            <li key={s.origin + s.genesis}>
              <div className="grow">
                <div className="name">{originLabel(s.origin)}</div>
                <div className="small muted">{formatTime(s.connectedAt)}</div>
              </div>
              <button className="btn tiny" onClick={() => ask('removeSite', { origin: s.origin }).then(load)}>
                {t.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Settings() {
  const { t, lang, setLang, status, go, refresh } = useApp();
  const [pin, setPin] = useState('');
  const { busy, error, run } = useAction();
  const n = status.node;

  async function logout(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await ask('logout', { pin });
      setPin('');
      go({ name: 'home' });
      await refresh();
    });
  }

  return (
    <>
      <Header title={t.settings} onBack={busy ? undefined : () => go({ name: 'home' })} />
      <div className="page">
        <Field label={t.language}>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {Object.entries(languages).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        <section className="card">
          <dl className="review">
            <dt>{t.loggedInAs}</dt>
            <dd>
              {status.session?.username} <span className="muted mono small">{shortHash(status.session?.genesis, 6)}</span>
            </dd>
            {n && (
              <>
                <dt>{t.network}</dt>
                <dd>{n.private ? t.privateNet : n.testnet ? t.testnet : t.mainnet}</dd>
                <dt>{t.height}</dt>
                <dd>{n.blocks.toLocaleString('en-US')}</dd>
                <dt>{t.version}</dt>
                <dd>{n.version}</dd>
              </>
            )}
          </dl>
          <button className="btn block" onClick={() => go({ name: 'node' })}>
            {t.nodeSettings}
          </button>
        </section>

        <LockAndBackup />

        <section className="card">
          <button className="btn block" type="button" onClick={() => go({ name: 'contacts' })}>
            {t.contacts}
          </button>
          <button className="btn block" type="button" onClick={() => go({ name: 'security' })}>
            {t.securityTitle}
          </button>
          <ExplorerSetting />
        </section>

        <Sites />

        <form className="card" onSubmit={logout}>
          <h2>{t.logoutTitle}</h2>
          <p className="small muted">{status.node?.multiuser ? t.logoutWarnMulti : t.logoutWarn}</p>
          <Field label={t.pin}>
            <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
          </Field>
          <ErrorBox error={error} />
          <button className="btn danger block" disabled={busy || !pin}>
            {t.logout}
          </button>
        </form>
      </div>
    </>
  );
}
