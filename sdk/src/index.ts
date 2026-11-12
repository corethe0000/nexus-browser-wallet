//typed window.nexus for websites; the Nexus Wallet browser extension puts it on every http and https page
import { DappErrors, type DappConnectInfo, type DappMethod, type DappRequests } from '../../src/lib/dapp';

export { DappErrors as NexusErrors };
export type { DappAccount, DappAsset, DappConnectInfo, DappMethod, DappNetwork, DappRequests } from '../../src/lib/dapp';
export type { SwapStep } from '../../src/lib/swap-step';
export type { SignedText } from '../../src/lib/signin';
export type { Balance, MarketOrder, OrderSide } from '../../src/lib/types';

//methods without params may leave them out
export type NexusRequestArgs<M extends DappMethod> = undefined extends DappRequests[M]['params']
  ? { method: M; params?: DappRequests[M]['params'] }
  : { method: M; params: DappRequests[M]['params'] };

export interface NexusEvents {
  //null after the user logged out
  accountsChanged: DappConnectInfo | null;
  //the user removed this site in the wallet
  disconnect: undefined;
}

export interface NexusProvider {
  readonly isNexusWallet: true;
  request<M extends DappMethod>(args: NexusRequestArgs<M>): Promise<DappRequests[M]['result']>;
  on<E extends keyof NexusEvents>(event: E, fn: (data: NexusEvents[E]) => void): NexusProvider;
  removeListener<E extends keyof NexusEvents>(event: E, fn: (data: NexusEvents[E]) => void): NexusProvider;
}

//errors of request() carry one of the NexusErrors codes
export interface NexusError extends Error {
  code: number;
}

//the provider, or null when the extension is not installed (it fires nexus#initialized when ready)
export function getNexus(timeoutMs = 2000): Promise<NexusProvider | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  const w = window as unknown as { nexus?: NexusProvider };
  if (w.nexus) {
    return Promise.resolve(w.nexus);
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('nexus#initialized', done);
      resolve(w.nexus ?? null);
    };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener('nexus#initialized', done);
  });
}

export function isUserRejected(e: unknown): boolean {
  return (e as NexusError | null)?.code === DappErrors.UserRejected;
}
