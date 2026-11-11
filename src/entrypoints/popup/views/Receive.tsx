import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { shortHash } from '../../../lib/format';
import type { Account } from '../../../lib/types';
import { useApp } from '../context';
import { CopyButton, ErrorBox, Field, Header, Qr, Spinner } from '../components';

export function Receive({ account: initial }: { account?: string }) {
  const { t, go } = useApp();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [address, setAddress] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ask('accounts')
      .then((list) => {
        const own = list.filter((a) => a.type !== 'TRUST');
        setAccounts(own);
        if (!initial && own.length) {
          setAddress((own.find((a) => a.token === '0') ?? own[0]!).address);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [initial]);

  const account = accounts?.find((a) => a.address === address);

  return (
    <>
      <Header title={t.receiveTitle} onBack={() => go({ name: 'home' })} />
      <div className="page">
        <ErrorBox error={error} />
        {!accounts && !error && <Spinner />}
        {accounts && !accounts.length && <p className="empty">{t.noAccounts}</p>}
        {accounts && accounts.length > 0 && (
          <>
            <p className="muted small">{t.receiveIntro}</p>
            <Field label={t.account}>
              <select value={address} onChange={(e) => setAddress(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.name || shortHash(a.address)} ({a.ticker || shortHash(a.token, 4)})
                  </option>
                ))}
              </select>
            </Field>
            {account && (
              <div className="receive-box">
                <Qr value={account.address} />
                <div className="mono small break center">{account.address}</div>
                <CopyButton value={account.address} label={t.copy} done={t.copied} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
