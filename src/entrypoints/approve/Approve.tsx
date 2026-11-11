import { defaultExpiry } from '../../lib/claims';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ask } from '../../lib/messages';
import { defaultLang, texts, type Lang } from '../../lib/i18n';
import { loadLang } from '../../lib/settings';
import { formatAmount, shortHash } from '../../lib/format';
import { originLabel, type ApprovalInfo, type SendParams } from '../../lib/dapp';
import type { Account, Balance, WalletStatus } from '../../lib/types';
import { AppContext, useApp } from '../popup/context';
import { useAction } from '../popup/useAction';
import { ErrorBox, Field, Header, Spinner, Ticker } from '../popup/components';
import { Login } from '../popup/views/Login';
import { Lock } from '../popup/views/Lock';
import { watchActivity } from '../popup/activity';
import { InvoicePay } from '../popup/views/InvoicePay';
import { choicesFor, OrderAction, type Action } from '../popup/views/Market';
import { deriveKey } from '../../lib/keys';
import { signText } from '../../lib/signin';

//keeps the background awake while the user thinks, and notices a request that went away
const pingMs = 20000;

const requestId = new URLSearchParams(location.search).get('id') ?? '';

export function Approve() {
  const [lang, setLang] = useState<Lang>(defaultLang());
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [info, setInfo] = useState<ApprovalInfo | null>(null);
  const [gone, setGone] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await ask('status'));
  }, []);

  useEffect(() => {
    loadLang().then((l) => l && setLang(l as Lang));
    ask('approvalGet', { id: requestId }).then(setInfo, () => setGone(true));
    refresh();
    const stopWatch = watchActivity();
    const timer = setInterval(() => {
      ask('approvalGet', { id: requestId }).catch(() => setGone(true));
    }, pingMs);
    return () => {
      clearInterval(timer);
      stopWatch();
    };
  }, [refresh]);

  const t = useMemo(() => texts(lang), [lang]);

  let body;
  if (gone) {
    body = (
      <>
        <Header title={t.appName} />
        <div className="page">
          <div className="notice warn">{t.requestGone}</div>
          <button className="btn block" onClick={() => window.close()}>
            {t.close}
          </button>
        </div>
      </>
    );
  } else if (!status || !info) {
    body = (
      <>
        <Header title={t.appName} />
        <Spinner text={t.loading} />
      </>
    );
  } else if (!status.node || status.nodeError) {
    body = (
      <>
        <Header title={t.appName} />
        <div className="page">
          <div className="notice error">
            <strong>{t.nodeDown}</strong>
            <div className="small">{status.nodeError?.message}</div>
          </div>
          <RejectButton />
        </div>
      </>
    );
  } else if (!status.session) {
    body = (
      <>
        <SiteBanner origin={info.origin} text={t.loginFirst} />
        <Login />
      </>
    );
  } else if (info.genesis && status.session.genesis !== info.genesis) {
    //logged in as someone else since the site asked
    body = (
      <>
        <Header title={t.appName} />
        <div className="page">
          <div className="notice warn">{t.wrongAccount}</div>
          <RejectButton label={t.close} />
        </div>
      </>
    );
  } else if (status.locked) {
    body = <Lock banner={<SiteBanner origin={info.origin} text={t.unlockFirst} />} />;
  } else if (info.kind === 'connect') {
    body = <ConnectRequest info={info} />;
  } else if (info.kind === 'order') {
    body = <OrderRequest info={info} />;
  } else if (info.kind === 'invoice') {
    body = (
      <>
        <Header title={t.invoiceRequestTitle} />
        <SiteBanner origin={info.origin} text={t.invoiceRequestText} />
        <InvoicePay address={info.invoice!} onPaid={(txid) => ask('approvalDone', { id: info.id, result: { txid } })} extra={(busy) => <RejectButton disabled={busy} />} />
      </>
    );
  } else if (info.kind === 'sign') {
    body = <SignRequest info={info} />;
  } else {
    body = <SendRequest info={info} />;
  }

  if (!status) {
    return <div className="app">{body}</div>;
  }
  return (
    <AppContext.Provider value={{ lang, t, setLang, status, refresh, view: { name: 'home' }, go: () => {} }}>
      <div className="app">{body}</div>
    </AppContext.Provider>
  );
}

function SiteBanner({ origin, text }: { origin: string; text: string }) {
  return (
    <div className="site-banner">
      <div className="site-origin">{originLabel(origin)}</div>
      <div className="small muted">{text}</div>
    </div>
  );
}

//disabled while the approved action runs: the site must not hear "rejected" for something that is on its way
function RejectButton({ label, disabled }: { label?: string; disabled?: boolean }) {
  const { t } = useApp();
  return (
    <button className="btn block" type="button" disabled={disabled} onClick={() => ask('approvalReject', { id: requestId })}>
      {label ?? t.reject}
    </button>
  );
}

function ConnectRequest({ info }: { info: ApprovalInfo }) {
  const { t, status } = useApp();
  const { busy, error, run } = useAction();
  return (
    <>
      <Header title={t.connectTitle} />
      <div className="page">
        <SiteBanner origin={info.origin} text={t.connectText} />
        <div className="card">
          <div className="small muted">{t.loggedInAs}</div>
          <div>
            {status.session?.username} <span className="mono small muted">{shortHash(status.session?.genesis, 6)}</span>
          </div>
        </div>
        <p className="small muted">{t.connectSees}</p>
        <p className="small muted">{t.connectTrust}</p>
        <ErrorBox error={error} />
        <div className="row">
          <RejectButton disabled={busy} />
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              await run(async () => {
                await ask('approvalDone', { id: info.id, result: true });
              });
            }}
          >
            {t.connect}
          </button>
        </div>
      </div>
    </>
  );
}

//the sign key is made here from password and PIN, both are dropped right after
function SignRequest({ info }: { info: ApprovalInfo }) {
  const { t, status } = useApp();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, run } = useAction();

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    const session = status.session;
    const text = info.text;
    if (!session || !text) {
      return;
    }
    await run(async () => {
      const reg = await ask('cryptoRegister');
      if (!reg || !reg.sign || /^0+$/.test(reg.sign)) {
        throw new Error(t.noSignKey);
      }
      const key = await deriveKey(session.username, password, pin, 'sign');
      let signed;
      try {
        if (key.hash.toLowerCase() !== reg.sign.toLowerCase()) {
          throw new Error(t.wrongSignCredentials);
        }
        signed = signText(text, key.privateKey, key.publicKey, session.genesis);
      } finally {
        key.privateKey.fill(0);
      }
      setPassword('');
      setPin('');
      await ask('approvalDone', { id: info.id, result: signed });
    });
  }

  return (
    <>
      <Header title={t.signTitle} />
      <form className="page" onSubmit={sign}>
        <SiteBanner origin={info.origin} text={t.signText} />
        <pre className="sign-text">{info.text}</pre>
        <p className="small muted">{t.signNote}</p>
        <Field label={t.password}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
        </Field>
        <Field label={t.pin}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
        </Field>
        <ErrorBox error={error} />
        <div className="row">
          <RejectButton disabled={busy} />
          <button className="btn primary" disabled={busy || !password || !pin}>
            {busy ? t.signing : t.sign}
          </button>
        </div>
      </form>
    </>
  );
}

//market request of a site: the same form as the market page, with the site's values locked
function OrderRequest({ info }: { info: ApprovalInfo }) {
  const { t } = useApp();
  const req = info.order!;
  const [data, setData] = useState<{ accounts: Account[]; balances: Balance[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([ask('accounts'), ask('balances')])
      .then(([accounts, balances]) => setData({ accounts, balances }))
      .catch((e) => setError((e as Error).message));
  }, []);

  const action: Action = req.action === 'place' ? { kind: 'new' } : { kind: req.action, order: req.found! };
  const text = req.action === 'fill' ? t.orderFillText : req.action === 'cancel' ? t.orderCancelText : t.orderPlaceText;

  return (
    <>
      <Header title={t.orderRequestTitle} />
      <SiteBanner origin={info.origin} text={text} />
      <div className="page">
        <div className="small muted center">{req.market}</div>
        <ErrorBox error={error} />
        {!data && !error && <Spinner />}
        {data && (() => {
          const [a, b] = choicesFor(data.balances, req.market);
          return (
            <OrderAction
              action={action}
              a={a}
              b={b}
              accounts={data.accounts}
              preset={req.action === 'place' ? { side: req.side === 'buy' ? 'bid' : 'ask', amount: req.amount!, price: req.price! } : undefined}
              closeLabel={t.reject}
              onClose={(done, txid) => (done ? ask('approvalDone', { id: info.id, result: { txid } }) : ask('approvalReject', { id: info.id }))}
            />
          );
        })()}
      </div>
    </>
  );
}

function matchesToken(a: Account, token: string): boolean {
  if (token === '0') {
    return a.token === '0';
  }
  return a.token === token || (!!a.ticker && a.ticker.toUpperCase() === token.toUpperCase());
}

function SendRequest({ info }: { info: ApprovalInfo }) {
  const { t } = useApp();
  const p = info.params as SendParams;
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [from, setFrom] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    Promise.all([ask('accounts'), ask('balances')])
      .then(([list, b]) => {
        const usable = list.filter((a) => a.type !== 'TRUST' && matchesToken(a, p.token));
        //the fullest account first
        usable.sort((x, y) => y.balance - x.balance);
        setAccounts(usable);
        setBalances(b);
        if (usable.length) {
          setFrom(usable[0]!.address);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [p.token]);

  const account = accounts?.find((a) => a.address === from);
  const decimals = account ? (balances.find((b) => b.token === account.token)?.decimals ?? 6) : 6;
  const ticker = account?.ticker ?? (p.token === '0' ? 'NXS' : shortHash(p.token, 4));
  const tooPrecise = (String(p.amount).split('.')[1]?.length ?? 0) > decimals;
  const tooMuch = !!account && p.amount > account.balance;

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!account) {
      return;
    }
    await run(async () => {
      const r = await ask('send', { from: account.address, to: p.to, amount: p.amount, reference: p.reference, expires: defaultExpiry, pin });
      setPin('');
      await ask('approvalDone', { id: info.id, result: { txid: r.txid } });
    });
  }

  return (
    <>
      <Header title={t.sendRequestTitle} />
      <form className="page" onSubmit={approve}>
        <SiteBanner origin={info.origin} text={t.sendRequestText} />
        {!accounts && !error && <Spinner />}
        {accounts && (
          <>
            <dl className="review">
              <dt>{t.to}</dt>
              <dd className="mono break">{p.to}</dd>
              <dt>{t.amount}</dt>
              <dd className="big">
                {formatAmount(p.amount, 8)} <Ticker ticker={ticker} token={account?.token} />
              </dd>
              <dt>{t.expiresLabel}</dt>
              <dd>{t.expires7d}</dd>
              {p.reference && (
                <>
                  <dt>{t.reference}</dt>
                  <dd>{p.reference}</dd>
                </>
              )}
            </dl>
            {accounts.length === 0 ? (
              <div className="notice error">{t.noMatchingAccount}</div>
            ) : (
              <Field label={t.from} error={tooMuch ? t.tooMuch : tooPrecise ? t.badAmount : null}>
                <select value={from} onChange={(e) => setFrom(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.name || shortHash(a.address)} - {formatAmount(a.balance, decimals)} {a.ticker || ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {accounts.length > 0 && (
              <Field label={t.confirmWithPin}>
                <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required autoFocus />
              </Field>
            )}
          </>
        )}
        <ErrorBox error={error} />
        <div className="row">
          <RejectButton disabled={busy} />
          <button className="btn primary" disabled={busy || !account || !pin || tooMuch || tooPrecise}>
            {busy ? t.sending : t.approveSend}
          </button>
        </div>
      </form>
    </>
  );
}
