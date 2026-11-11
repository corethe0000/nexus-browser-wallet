import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, formatTime, shortHash } from '../../../lib/format';
import type { Notification } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { ErrorBox, Field, Header, Spinner } from '../components';
import { partName } from './Home';
import { isAssetTransfer, isClaimable } from '../../../lib/claims';

//incoming debits wait until the receiver credits them, the desktop wallet does it when unlocked for notifications
export function Claim() {
  const { t, go, status } = useApp();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [pin, setPin] = useState('');
  const { busy, error, setError, run } = useAction();
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    ask('notifications')
      .then((n) => setItems(n.filter((x) => isClaimable(x))))
      .catch((e) => setError((e as Error).message));
  }, []);

  async function claimAll(e: React.FormEvent) {
    e.preventDefault();
    if (!items) {
      return;
    }
    await run(async () => {
      //signing in this browser: one transaction claims them all
      if (status.localMode) {
        await ask('claimAll', { txids: [...new Set(items.map((n) => n.txid))], pin });
        setPin('');
        go({ name: 'home' });
        return;
      }
      for (const n of items) {
        if (!done.includes(n.txid)) {
          await ask(isAssetTransfer(n) ? 'claimAsset' : 'claim', { txid: n.txid, pin });
          setDone((d) => [...d, n.txid]);
        }
      }
      setPin('');
      go({ name: 'home' });
    });
  }

  //totals per token and the number of assets, shown above the list with the PIN so a long list needs no scrolling
  const totals = new Map<string, number>();
  let assets = 0;
  for (const n of items ?? []) {
    if (isAssetTransfer(n)) {
      assets += 1;
    } else {
      const k = n.ticker || 'NXS';
      totals.set(k, (totals.get(k) ?? 0) + Number(n.amount ?? 0));
    }
  }

  return (
    <>
      <Header title={t.claimTitle} onBack={busy ? undefined : () => go({ name: 'home' })} />
      <form className="page" onSubmit={claimAll}>
        {!items && !error && <Spinner />}
        {items && items.length === 0 && <p className="muted center">{t.nothingToClaim}</p>}
        {items && items.length > 0 && (
          <section className="card">
            <div className="claim-totals">
              {[...totals].map(([ticker, sum]) => (
                <span key={ticker} className="amount in">
                  +{formatAmount(sum)} {ticker}
                </span>
              ))}
              {assets > 0 && <span>{assets === 1 ? t.assetsOne : t.assetsCount.replace('{n}', String(assets))}</span>}
            </div>
            <Field label={t.confirmWithPin}>
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required autoFocus />
            </Field>
            <ErrorBox error={error} />
            <button className="btn primary block" disabled={busy || !pin}>
              {busy ? t.claiming.replace('{done}', String(done.length + 1)).replace('{all}', String(items.length)) : t.claimAll}
            </button>
          </section>
        )}
        {items && (
          <ul className="list">
            {items.map((n) => {
              if (isAssetTransfer(n)) {
                return (
                  <li key={n.txid}>
                    <div className="grow">
                      <div className="name">
                        {t.asset} {n.name ?? shortHash(n.address)}
                      </div>
                      <div className="small muted">{formatTime(n.timestamp)}</div>
                    </div>
                    <div className="amount in">{done.includes(n.txid) ? '✓' : ''}</div>
                  </li>
                );
              }
              const label = `${t.actFrom} ${partName(n.from)}`;
              return (
                <li key={n.txid}>
                  <div className="grow">
                    <div className="name">{label}</div>
                    <div className="small muted">{formatTime(n.timestamp)}</div>
                  </div>
                  <div className="amount in">
                    +{formatAmount(n.amount)} {n.ticker || 'NXS'}
                    {done.includes(n.txid) && ' ✓'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(!items || items.length === 0) && <ErrorBox error={error} />}
      </form>
    </>
  );
}
