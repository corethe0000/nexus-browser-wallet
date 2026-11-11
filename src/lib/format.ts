//number and text helpers for the UI

export function formatAmount(value: number | undefined, decimals = 6): string {
  const v = Number(value ?? 0);
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: Math.min(decimals, 8) });
}

export function shortHash(value: string | undefined, keep = 6): string {
  if (!value) {
    return '';
  }
  return value.length <= keep * 2 + 3 ? value : `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

export function formatTime(unix: number | undefined): string {
  if (!unix) {
    return '';
  }
  return new Date(unix * 1000).toLocaleString();
}

//parses what the user typed as amount, accepts comma as decimal mark
export function parseAmount(text: string, decimals: number): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) {
    return null;
  }
  const frac = t.split('.')[1] ?? '';
  if (frac.length > decimals) {
    return null;
  }
  const v = Number(t);
  return v > 0 && Number.isFinite(v) ? v : null;
}

//base58 register address, 51 chars, starts with 8
const addressPattern = /^8[1-9A-HJ-NP-Za-km-z]{50}$/;
//name, user:name or namespace::name
const namePattern = /^([^\s:]+(::?))?[^\s:]+$/;

export function isRecipient(text: string): boolean {
  const t = text.trim();
  return addressPattern.test(t) || namePattern.test(t);
}

export function isAddress(text: string): boolean {
  return addressPattern.test(text.trim());
}

export function isReference(text: string): boolean {
  const t = text.trim();
  return t === '' || (/^\d{1,20}$/.test(t) && BigInt(t) <= 18446744073709551615n);
}
