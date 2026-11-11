import { useEffect, useState } from 'react';
import { ask } from '../../../lib/messages';
import { formatAmount, parseAmount } from '../../../lib/format';
import type { StakeInfo } from '../../../lib/types';
import { useApp } from '../context';
import { useAction } from '../useAction';
import { CopyButton, ErrorBox, Field, Header, Spinner } from '../components';

const nxsDecimals = 6;

//finance/set/stake and the core's stake minter (sessions/unlock or lock with staking)
export function Stake() {
  const { t, go, status } = useApp();
  const [info, setInfo] = useState<StakeInfo | null | undefined>(undefined);
  const [amountText, setAmountText] = useState('');
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();
  const multiuser = !!status.node?.multiuser;

  async function load() {
    try {
      const s = await ask('stakeInfo');
      setInfo(s);
      if (s && !amountText) {
        setAmountText(String(Number(s.stake.toFixed(nxsDecimals))));
      }
    } catch (e) {
      setError((e as Error).message);
      setInfo(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (info === undefined) {
    return (
      <>
        <Header title={t.stakeTitle} onBack={() => go({ name: 'home' })} />
        <div className="page">
          <Spinner />
        </div>
      </>
    );
  }

  const amount = /^0+([.,]0*)?$/.test(amountText.trim()) ? 0 : parseAmount(amountText, nxsDecimals);
  const amountError = !info
    ? null
    : amount === null
      ? t.badAmount
      : amount === info.stake
        ? t.stakeSame
        : amount > info.stake + info.balance
          ? t.stakeTooMuch
          : null;

  async function saveStake(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (amountError || amount === null) {
      return;
    }
    await run(async () => {
      await ask('setStake', { amount, pin });
      setPin('');
      setSaved(true);
      setTouched(false);
      await load();
    });
  }

  async function toggle(on: boolean) {
    await run(async () => {
      await ask('setStaking', { on, pin });
      setPin('');
      await load();
    });
  }

  return (
    <>
      <Header title={t.stakeTitle} onBack={busy ? undefined : () => go({ name: 'home' })} />
      <form className="page" onSubmit={saveStake}>
        {!info && <ErrorBox error={error ?? t.noTrust} />}
        {info && (
          <>
            <dl className="review">
              <dt>{t.stakeNow}</dt>
              <dd>{formatAmount(info.stake)} NXS</dd>
              <dt>{t.trustBalance}</dt>
              <dd>{formatAmount(info.balance)} NXS</dd>
            </dl>
            <p className="small muted">{t.stakeAvailable.replace('{amount}', formatAmount(info.balance))}</p>
            <CopyButton value={info.address} label={t.copyTrust} done={t.copied} />
            {info.change && info.amount !== undefined && <div className="notice info small">{t.stakeChangeText.replace('{amount}', formatAmount(info.amount))}</div>}
            {saved && <div className="notice ok">{t.stakeSaved}</div>}
            <Field label={t.stakeNew} hint={t.stakeNewHint} error={touched ? amountError : null}>
              <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" autoComplete="off" disabled={busy} />
            </Field>
            <Field label={t.confirmWithPin}>
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" disabled={busy} />
            </Field>
            <ErrorBox error={error} />
            <button className="btn primary block" disabled={busy || !pin}>
              {busy ? t.stakeSaving : t.stakeSave}
            </button>
            <section className="card">
              <h2>{t.stakingCore}</h2>
              {multiuser ? (
                <p className="small muted">{t.stakingMulti}</p>
              ) : (
                <>
                  <p className="small muted">{info.staking ? t.stakingOnText : t.stakingOffText}</p>
                  <button type="button" className={`btn block ${info.staking ? '' : 'primary'}`} disabled={busy || !pin} onClick={() => toggle(!info.staking)}>
                    {busy ? t.stakingWorking : info.staking ? t.stakingStop : t.stakingStart}
                  </button>
                </>
              )}
            </section>
          </>
        )}
      </form>
    </>
  );
}
