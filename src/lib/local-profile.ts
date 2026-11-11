//a new profile for "sign in this browser": the first transaction is built and its proof of work done in the page
//the user keeps open (it takes a minute or two on a mother network), the background only submits it
import { ask } from './messages';
import { deriveKey, genesisOf } from './keys';
import { buildGenesis } from './tritium';

export async function createLocalProfile(username: string, password: string, pin: string, onProgress: (tries: number) => void): Promise<string> {
  const net = await ask('localNetwork');
  const genesis = net.userType + (await genesisOf(username)).slice(2);
  if (await ask('profileExists', { genesis })) {
    throw new Error('This username is taken on this network');
  }
  const keys = [];
  for (const t of ['auth', 'network', 'sign']) {
    const k = await deriveKey(username, password, pin, t);
    k.privateKey.fill(0);
    keys.push(k.hash);
  }
  const signed = await buildGenesis({ username, password, pin, genesis, hybrid: net.hybrid, timestamp: Math.floor(Date.now() / 1000), onProgress }, { auth: keys[0]!, network: keys[1]!, sign: keys[2]! });
  await ask('submitGenesis', { data: signed.data, txid: signed.txid });
  return signed.txid;
}
