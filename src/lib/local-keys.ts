//"sign in this browser": username and password of the profile, kept only in storage.session (memory, gone when
//the browser closes), never sent to the node; the PIN is asked for every transaction
const keysKey = 'localKeys';
const lastKey = 'localLastTx';

export interface LocalKeys {
  node: string;
  username: string;
  password: string;
  genesis: string;
}

//the last transaction this wallet submitted, so the next one waits until it is in a block
export interface LastSubmitted {
  genesis: string;
  txid: string;
}

export async function loadLocalKeys(nodeUrl: string): Promise<LocalKeys | null> {
  const got = await browser.storage.session.get(keysKey);
  const k = got[keysKey] as LocalKeys | undefined;
  return k && k.node === nodeUrl ? k : null;
}

export async function saveLocalKeys(k: LocalKeys): Promise<void> {
  await browser.storage.session.set({ [keysKey]: k });
}

export async function clearLocalKeys(): Promise<void> {
  await browser.storage.session.remove([keysKey, lastKey]);
}

export async function loadLastSubmitted(genesis: string): Promise<LastSubmitted | null> {
  const got = await browser.storage.session.get(lastKey);
  const l = got[lastKey] as LastSubmitted | undefined;
  return l && l.genesis === genesis ? l : null;
}

export async function saveLastSubmitted(l: LastSubmitted | null): Promise<void> {
  if (l) {
    await browser.storage.session.set({ [lastKey]: l });
  } else {
    await browser.storage.session.remove(lastKey);
  }
}
