import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { defaultNode, normalizeUrl, type NodeSettings } from '../../../lib/node';
import { mustSignHere, nodeOrigin, suggestedNodes } from '../../../lib/settings';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Header } from '../components';

export function Setup() {
  //the saved API password stays in the background, an empty field keeps it for the same address
  //url of the saved core whose API password the background keeps
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const { t, status, refresh, go, view } = useApp();
  const prefill = view.name === 'node' ? view.prefill : undefined;
  const [node, setNode] = useState<NodeSettings>(defaultNode);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (prefill) {
      setNode(prefill);
    } else {
      ask('getNode').then((n) => {
        if (n) {
          setNode({ url: n.url, user: n.user, password: '', mode: n.mode, index: n.index });
          setPasswordFor(n.hasPassword ? n.url : null);
        }
      });
    }
  }, []);

  //a remote node without an API login is only used signing in this browser
  const forced = mustSignHere(node);
  const signHere = forced || node.mode === 'local';

  const set = (k: keyof NodeSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setNode({ ...node, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    //run calls the function at once, so the permission request below is still the first await of the click
    await run(async () => {
      let granted = true;
      try {
        //a node on another machine needs an extra host permission, asked inside the click
        const origin = nodeOrigin(node.url);
        if (origin) {
          granted = await browser.permissions.request({ origins: [origin] });
        }
      } catch {
        throw new Error(t.badUrl);
      }
      if (!granted) {
        throw new Error(t.permissionDenied);
      }
      await ask('saveNode', { node });
      await refresh();
      go({ name: 'home' });
    });
  }

  return (
    <>
      {status.configured ? (
        <Header title={t.setupTitle} onBack={busy ? undefined : () => go({ name: 'home' })} />
      ) : (
        <Header hero title={t.setupTitle} />
      )}
      <form className="page" onSubmit={submit}>
        {prefill ? <div className="notice warn small">{t.importedNode}</div> : <p className="muted">{t.setupIntro}</p>}
        {!prefill && (
          <section className="card">
            <h2>{t.suggestedNodes}</h2>
            <p className="small muted">{t.suggestedNodesHint}</p>
            <ul className="list">
              {suggestedNodes.map((s) => (
                <li key={s.node.url}>
                  <div className="grow">
                    <div className="name mono small break">{s.node.url}</div>
                    <div className="small muted">{s.kind === 'desktop' ? t.suggestDesktop : t.suggestPublic}</div>
                  </div>
                  <button
                    type="button"
                    className="btn tiny"
                    disabled={busy}
                    onClick={() => setNode({ ...s.node, index: s.kind === 'public' ? undefined : node.index })}
                  >
                    {t.useNode}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Field label={t.nodeUrl}>
          <input value={node.url} onChange={set('url')} spellCheck={false} placeholder={defaultNode.url} required />
        </Field>
        <Field label={t.apiUser}>
          <input value={node.user} onChange={set('user')} spellCheck={false} autoComplete="off" />
        </Field>
        <Field label={t.apiPassword} hint={signHere ? t.apiLoginLocal : t.setupWhere}>
          <input type="password" value={node.password} onChange={set('password')} autoComplete="off" placeholder={passwordFor && normalizeUrl(node.url) === passwordFor ? t.passwordSaved : ''} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={signHere} disabled={forced} onChange={(e) => setNode({ ...node, mode: e.target.checked ? 'local' : undefined })} />
          <span>{t.localMode}</span>
        </label>
        {forced && <p className="small muted">{t.localModeForced}</p>}
        {signHere && (
          <>
            <p className="small muted">{t.localModeHint}</p>
            <Field label={t.incomingIndex} hint={t.incomingIndexHint}>
              <input value={node.index ?? ''} onChange={set('index')} spellCheck={false} />
            </Field>
          </>
        )}
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy}>
          {busy ? t.connecting : t.connect}
        </button>
        {status.configured && !prefill && <SavedNodes disabled={busy} />}
      </form>
    </>
  );
}

//quick switch between cores this wallet used before, the API passwords stay in the background
function SavedNodes({ disabled }: { disabled: boolean }) {
  const { t, refresh, go } = useApp();
  const [list, setList] = useState<{ url: string; user: string; current: boolean }[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const load = () => ask('savedNodes').then(setList, () => {});

  useEffect(() => {
    load();
  }, []);

  if (list.length < 2) {
    return null;
  }

  const key = (n: { url: string; user: string }) => `${n.user}@${n.url}`;

  async function use(n: { url: string; user: string }) {
    setSwitching(key(n));
    const ok = await run(async () => {
      await ask('switchNode', { url: n.url, user: n.user });
      await refresh();
    });
    setSwitching(null);
    if (ok) {
      go({ name: 'home' });
    }
  }

  return (
    <section className="card">
      <h2>{t.savedNodes}</h2>
      <p className="small muted">{t.savedNodesHint}</p>
      <ul className="list">
        {list.map((n) => (
          <li key={key(n)}>
            <div className="grow">
              <div className="name mono small break">{n.url}</div>
              {n.user && <div className="small muted">{n.user}</div>}
            </div>
            {n.current ? (
              <span className="pill ok">{t.nodeInUse}</span>
            ) : (
              <div className="row">
                <button type="button" className="btn tiny" disabled={busy || disabled} onClick={() => use(n)}>
                  {switching === key(n) ? t.switchingNode : t.useNode}
                </button>
                <button
                  type="button"
                  className="btn tiny ghost"
                  aria-label={`${t.removeNode} ${n.url}`}
                  disabled={busy || disabled}
                  onClick={() => run(async () => {
                    await ask('removeSavedNode', { url: n.url, user: n.user });
                    await load();
                  })}
                >
                  x
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorBox error={error} />
    </section>
  );
}
