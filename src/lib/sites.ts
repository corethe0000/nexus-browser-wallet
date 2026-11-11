//websites the user allowed to connect, per origin and account: another user logging in on the same
//browser or core does not inherit them

const sitesKey = 'sites';

export interface ConnectedSite {
  origin: string;
  genesis: string;
  connectedAt: number;
}

export async function listSites(): Promise<ConnectedSite[]> {
  const got = await browser.storage.local.get(sitesKey);
  //entries from before accounts were stored have no genesis and count for nobody
  return ((got[sitesKey] as ConnectedSite[] | undefined) ?? []).filter((s) => typeof s.genesis === 'string');
}

export async function isConnected(origin: string, genesis: string | null | undefined): Promise<boolean> {
  return !!genesis && (await listSites()).some((s) => s.origin === origin && s.genesis === genesis);
}

export async function sitesFor(genesis: string): Promise<Set<string>> {
  return new Set((await listSites()).filter((s) => s.genesis === genesis).map((s) => s.origin));
}

export async function addSite(origin: string, genesis: string): Promise<void> {
  const sites = (await listSites()).filter((s) => !(s.origin === origin && s.genesis === genesis));
  sites.push({ origin, genesis, connectedAt: Math.floor(Date.now() / 1000) });
  await browser.storage.local.set({ [sitesKey]: sites });
}

export async function removeSite(origin: string, genesis: string): Promise<void> {
  const sites = (await listSites()).filter((s) => !(s.origin === origin && s.genesis === genesis));
  await browser.storage.local.set({ [sitesKey]: sites });
}
