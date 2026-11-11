//session this wallet got from a multi-user node, kept per node address so a restart does not need a new login
//(the wallet starts locked, and the core asks the PIN for every transaction anyway)
const key = 'nodeSession';

export interface StoredSession {
  node: string;
  id: string;
  username: string;
  genesis: string;
}

export async function loadSession(nodeUrl: string): Promise<StoredSession | null> {
  const got = await browser.storage.local.get(key);
  const s = got[key] as StoredSession | undefined;
  return s && s.node === nodeUrl ? s : null;
}

export async function saveSession(s: StoredSession): Promise<void> {
  await browser.storage.local.set({ [key]: s });
}

export async function clearSession(): Promise<void> {
  await browser.storage.local.remove(key);
}
