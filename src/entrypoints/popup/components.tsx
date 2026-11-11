import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';

//hero = the tall header with the Nexus wordmark, for the screens before the wallet is open
export function Header({ title, onBack, right, hero }: { title: string; onBack?: () => void; right?: ReactNode; hero?: boolean }) {
  if (hero) {
    return (
      <header className="header hero">
        {right && <div className="header-right hero-right">{right}</div>}
        <img className="wordmark" src="/img/nexus-logo-white.png" alt="Nexus" />
        <h1>{title}</h1>
      </header>
    );
  }
  return (
    <header className="header">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <img className="logo" src="/img/nexus-mark-white.png" alt="" />
      )}
      <h1>{title}</h1>
      <div className="header-right">{right}</div>
    </header>
  );
}

export function Spinner({ text }: { text?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {text && <div className="muted">{text}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) {
    return null;
  }
  return <div className="notice error">{error}</div>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn small"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? done : label}
    </button>
  );
}

export function Qr({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) {
      QRCode.toCanvas(ref.current, value, { width: 180, margin: 1, color: { dark: '#06365c', light: '#ffffff' } });
    }
  }, [value]);
  return <canvas className="qr" ref={ref} />;
}

export function Ticker({ ticker, token }: { ticker?: string; token?: string }) {
  if (ticker) {
    return <span className="ticker">{ticker}</span>;
  }
  return <span className="ticker unnamed">{token ? token.slice(0, 6) : '?'}</span>;
}
