import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatTime, shortHash } from '../../../lib/format';
import { loadExplorer } from '../../../lib/settings';
import { findContact, listContacts, saveContact, type Contact } from '../../../lib/contacts';
import type { Contract, Party, Transaction } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { CopyButton, ErrorBox, Field, Header } from '../components';
import { describe } from './Home';
import { expiresAt, isExpired } from '../../../lib/claims';

type Debit = Contract & { exchange?: boolean };

//a debit to someone else that is still not claimed can be taken back once its expiry has passed
function unclaimedSend(c: Debit): boolean {
  const to = typeof c.to === 'object' ? (c.to as Party) : undefined;
  return c.OP === 'DEBIT' && !c.exchange && !!to && !to.mine && c.claimed !== undefined && Number(c.claimed) < Number(c.amount ?? 0);
}

export function TxView({ tx }: { tx: Transaction }) {
  const { t, go } = useApp();
  const [explorer, setExplorer] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [voiding, setVoiding] = useState(false);
  const [pin, setPin] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    loadExplorer().then(setExplorer);
    listContacts().then(setContacts);
  }, []);

  const open = tx.contracts.find(unclaimedSend);
  const until = open ? expiresAt(open, tx.timestamp) : null;
  const canVoid = !!open && until !== null && isExpired(open, tx.timestamp) && !done;

  async function doVoid(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await ask('voidTx', { txid: tx.txid, pin });
      setPin('');
      setVoiding(false);
      setDone(t.voidDone);
    });
  }

  async function addContact(party: Party) {
    const to = party.address ?? '';
    await saveContact({ name: party.user && party.name ? `${party.user}:${party.name}` : party.name || shortHash(to, 6), to });
    setContacts(await listContacts());
    setSaved(to);
  }

  return (
    <>
      <Header title={t.txTitle} onBack={busy ? undefined : () => go({ name: 'home' })} />
      <div className="page">
        <dl className="review">
          <dt>{t.date}</dt>
          <dd>{formatTime(tx.timestamp)}</dd>
          <dt>{t.status}</dt>
          <dd>{tx.confirmations > 0 ? `${t.confirmed} (${tx.confirmations})` : t.pending}</dd>
          <dt>{t.txType}</dt>
          <dd>{tx.type}</dd>
        </dl>
        <div className="row-between">
          <span className="mono small muted break">{shortHash(tx.txid, 14)}</span>
          <CopyButton value={tx.txid} label={t.copy} done={t.copied} />
        </div>

        <ul className="list">
          {tx.contracts.map((c) => {
            const d = describe(c, t);
            if (!d) {
              return null;
            }
            const to = typeof c.to === 'object' ? (c.to as Party) : undefined;
            const known = findContact(contacts, to?.address);
            return (
              <li key={c.id} className="contract">
                <div className="grow">
                  <div className="name">
                    <span className={`op op-${c.OP.toLowerCase()}`}>{d.tag}</span> {known ? known.name : d.label}
                  </div>
                  {to?.address && <div className="small muted mono break">{to.address}</div>}
                  {c.reference ? (
                    <div className="small muted">
                      {t.reference}: {c.reference}
                    </div>
                  ) : null}
                  {c.OP === 'DEBIT' && to && !to.mine && c.claimed !== undefined && (
                    <div className="small muted">{Number(c.claimed) >= Number(c.amount) ? t.claimedYes : t.claimedNo}</div>
                  )}
                  {to && !to.mine && to.address && !known && (
                    <button className="btn tiny" type="button" onClick={() => addContact(to)}>
                      {saved === to.address ? t.contactSaved : t.saveContact}
                    </button>
                  )}
                </div>
                {d.amount && (
                  <div className={`amount ${d.sign === '+' ? 'in' : d.sign === '-' ? 'out' : ''}`}>
                    {d.sign}
                    {d.amount}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {done && <div className="notice ok">{done}</div>}
        {open && !done && (
          <p className="small muted">
            {until === null ? t.neverExpires : canVoid ? t.expiredText : t.claimUntil.replace('{date}', formatTime(until))}
          </p>
        )}
        {canVoid && !voiding && (
          <button className="btn block" type="button" onClick={() => setVoiding(true)}>
            {t.voidTx}
          </button>
        )}
        {voiding && (
          <form className="card" onSubmit={doVoid}>
            <p className="small muted">{t.voidText}</p>
            <Field label={t.confirmWithPin}>
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required autoFocus />
            </Field>
            <ErrorBox error={error} />
            <div className="row">
              <button type="button" className="btn" disabled={busy} onClick={() => setVoiding(false)}>
                {t.cancel}
              </button>
              <button className="btn primary" disabled={busy || !pin}>
                {busy ? t.sending : t.voidConfirm}
              </button>
            </div>
          </form>
        )}

        {explorer && (
          <button className="btn ghost block" type="button" onClick={() => browser.tabs.create({ url: `${explorer}/scan/${tx.txid}` })}>
            {t.openExplorer}
          </button>
        )}
      </div>
    </>
  );
}
