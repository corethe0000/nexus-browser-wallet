import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatTime, shortHash } from '../../../lib/format';
import type { Asset } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { CopyButton, ErrorBox, Field, Header, Spinner } from '../components';
import { InvoicePay } from './InvoicePay';
import { registerFields } from './Home';

export function InvoiceView({ address }: { address: string }) {
  const { t, go } = useApp();
  const [done, setDone] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  return (
    <>
      <Header title={t.invoice} onBack={paying ? undefined : () => go({ name: 'home' })} />
      {done ? (
        <div className="page">
          <div className="notice ok">{done}</div>
          <button className="btn primary block" onClick={() => go({ name: 'home' })}>
            {t.close}
          </button>
        </div>
      ) : (
        <InvoicePay address={address} onPaid={() => setDone(t.invoicePaid)} onRejected={() => setDone(t.invoiceRejected)} onCancelled={() => setDone(t.invoiceCancelled)} onBusy={setPaying} />
      )}
    </>
  );
}

export function AssetView({ address }: { address: string }) {
  const { t, go } = useApp();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [recipient, setRecipient] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, setError, run } = useAction();
  const [txid, setTxid] = useState('');

  useEffect(() => {
    ask('assets')
      .then((list) => setAsset(list.find((a) => a.address === address) ?? null))
      .catch((e) => setError((e as Error).message));
  }, [address]);

  async function transfer(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await ask('transferAsset', { address, recipient, pin });
      setPin('');
      setTxid(r.txid);
    });
  }

  const own = asset ? Object.entries(asset).filter(([k]) => !registerFields.has(k)) : [];

  return (
    <>
      <Header title={asset?.name || t.asset} onBack={busy ? undefined : () => go({ name: 'home' })} />
      <div className="page">
        {!asset && !error && <Spinner />}
        <ErrorBox error={error && !asset ? error : null} />
        {asset && (
          <>
            <dl className="review">
              {own.map(([k, v]) => (
                <span key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd className="break">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                </span>
              ))}
              <dt>{t.registerType}</dt>
              <dd>
                {asset.type}
                {asset.form ? ` / ${asset.form}` : ''}
              </dd>
              <dt>{t.date}</dt>
              <dd>{formatTime(asset.created)}</dd>
            </dl>
            <div className="row-between">
              <span className="mono small muted">{shortHash(asset.address, 10)}</span>
              <CopyButton value={asset.address} label={t.copy} done={t.copied} />
            </div>
            {txid ? (
              <div className="notice ok">{t.assetSent}</div>
            ) : (
              <form className="card" onSubmit={transfer}>
                <h2>{t.transferAsset}</h2>
                <Field label={t.recipient} hint={t.recipientHint}>
                  <input value={recipient} onChange={(e) => setRecipient(e.target.value)} spellCheck={false} autoComplete="off" required />
                </Field>
                <Field label={t.confirmWithPin}>
                  <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
                </Field>
                <ErrorBox error={error} />
                <button className="btn primary block" disabled={busy || !recipient.trim() || !pin}>
                  {busy ? t.sending : t.transfer}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </>
  );
}
