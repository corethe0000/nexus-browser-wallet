import { createContext, useContext } from 'react';
import { texts, type Lang } from '../../lib/i18n';
import type { Transaction, WalletStatus } from '../../lib/types';
import type { CreateKind } from './views/Create';
import type { NodeSettings } from '../../lib/node';

export type View =
  | { name: 'home' }
  | { name: 'send'; from?: string; to?: string }
  | { name: 'receive'; account?: string }
  | { name: 'settings' }
  | { name: 'node'; prefill?: NodeSettings }
  | { name: 'claim' }
  | { name: 'market' }
  | { name: 'tx'; tx: Transaction }
  | { name: 'contacts' }
  | { name: 'stake' }
  | { name: 'newInvoice' }
  | { name: 'security' }
  | { name: 'create'; kind?: CreateKind }
  | { name: 'invoice'; address: string }
  | { name: 'asset'; address: string };

export interface AppState {
  lang: Lang;
  t: ReturnType<typeof texts>;
  setLang: (lang: Lang) => void;
  status: WalletStatus;
  refresh: () => Promise<void>;
  view: View;
  go: (view: View) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('AppContext missing');
  }
  return ctx;
}
