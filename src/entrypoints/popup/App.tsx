import { useCallback, useEffect, useMemo, useState } from 'react';
import { ask } from '../../lib/messages';
import { defaultLang, texts, type Lang } from '../../lib/i18n';
import { loadLang, saveLang } from '../../lib/settings';
import type { WalletStatus } from '../../lib/types';
import { AppContext, type View } from './context';
import { Header, Spinner } from './components';
import { Setup } from './views/Setup';
import { Login } from './views/Login';
import { Home } from './views/Home';
import { Send } from './views/Send';
import { Receive } from './views/Receive';
import { Settings } from './views/Settings';
import { Claim } from './views/Claim';
import { AssetView, InvoiceView } from './views/Detail';
import { Market } from './views/Market';
import { TxView } from './views/TxView';
import { Contacts } from './views/Contacts';
import { Create } from './views/Create';
import { Stake } from './views/Stake';
import { NewInvoice } from './views/NewInvoice';
import { Security } from './views/Security';
import { Lock } from './views/Lock';
import { watchActivity } from './activity';

const statusRefreshMs = 20000;

export function App() {
  const [lang, setLangState] = useState<Lang>(defaultLang());
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [view, setView] = useState<View>({ name: 'home' });

  const refresh = useCallback(async () => {
    try {
      setStatus(await ask('status'));
    } catch (e) {
      setStatus({ configured: true, node: null, nodeError: { code: -1, message: (e as Error).message }, session: null });
    }
  }, []);

  useEffect(() => {
    loadLang().then((l) => l && setLangState(l as Lang));
    refresh();
    //notices the auto lock while the popup stays open
    const timer = setInterval(refresh, statusRefreshMs);
    const stop = watchActivity();
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [refresh]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    saveLang(l);
  }, []);

  const t = useMemo(() => texts(lang), [lang]);

  if (!status) {
    return (
      <div className="app">
        <Header title={t.appName} />
        <Spinner text={t.loading} />
      </div>
    );
  }

  const ctx = { lang, t, setLang, status, refresh, view, go: setView };

  let body;
  //while locked the core settings stay closed: they hold the API password and decide where the login goes
  if (!status.configured) {
    body = <Setup />;
  } else if (status.locked && (!status.node || status.nodeError)) {
    body = <NodeProblem />;
  } else if (status.locked && status.session) {
    body = <Lock />;
  } else if (view.name === 'node' && !status.locked) {
    body = <Setup />;
  } else if (!status.node || status.nodeError) {
    body = <NodeProblem />;
  } else if (!status.session) {
    body = <Login />;
  } else if (view.name === 'send') {
    body = <Send from={view.from} to={view.to} />;
  } else if (view.name === 'receive') {
    body = <Receive account={view.account} />;
  } else if (view.name === 'settings') {
    body = <Settings />;
  } else if (view.name === 'tx') {
    body = <TxView tx={view.tx} />;
  } else if (view.name === 'security') {
    body = <Security />;
  } else if (view.name === 'newInvoice') {
    body = <NewInvoice />;
  } else if (view.name === 'stake') {
    body = <Stake />;
  } else if (view.name === 'create') {
    body = <Create kind={view.kind} />;
  } else if (view.name === 'contacts') {
    body = <Contacts />;
  } else if (view.name === 'market') {
    body = <Market />;
  } else if (view.name === 'invoice') {
    body = <InvoiceView address={view.address} />;
  } else if (view.name === 'asset') {
    body = <AssetView address={view.address} />;
  } else if (view.name === 'claim') {
    body = <Claim />;
  } else {
    body = <Home />;
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">{body}</div>
    </AppContext.Provider>
  );
}

function NodeProblem() {
  return (
    <AppContext.Consumer>
      {(ctx) => {
        const { t, status, refresh, go } = ctx!;
        return (
          <>
            <Header title={t.appName} />
            <div className="page">
              <div className="notice error">
                <strong>{t.nodeDown}</strong>
                <div className="small">{status.nodeError?.message}</div>
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => refresh()}>
                  {t.retry}
                </button>
                {!status.locked && (
                  <button className="btn" onClick={() => go({ name: 'node' })}>
                    {t.nodeSettings}
                  </button>
                )}
              </div>
              {status.locked && (
                <section className="card">
                  <p className="small muted">{t.resetNodeText}</p>
                  <button
                    className="btn block"
                    onClick={async () => {
                      await ask('resetNode');
                      go({ name: 'home' });
                      await refresh();
                    }}
                  >
                    {t.resetNode}
                  </button>
                </section>
              )}
            </div>
          </>
        );
      }}
    </AppContext.Consumer>
  );
}
