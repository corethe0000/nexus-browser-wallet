import { ErrorCodes, NexusError, normalizeUrl, type NodeSettings } from '../lib/node';
import { isSharedLogin } from '../lib/settings';
import { importContacts, listContacts } from '../lib/contacts';
import { defaultExplorer, forgetNode, isExplorerUrl, isRemote, loadExplorer, saveExplorer, loadLang, loadNode, loadNodeChange, loadSavedNodes, removeSavedNode, sameNode, saveLang, saveNode, setNodeChange, withSafeMode } from '../lib/settings';
import { isLocked, lockChoices, lockMinutes, lockNow, setLockMinutes, touch } from '../lib/lock';
import { Wallet } from '../lib/wallet';
import { LocalWallet } from '../lib/local-wallet';
import { parseTx } from '../lib/tritium';
import { clearLocalKeys, loadLocalKeys } from '../lib/local-keys';
import { refreshBadge, setBadge } from '../lib/badge';
import { clearSession, loadSession, saveSession } from '../lib/session-store';
import type { Message, Reply } from '../lib/messages';
import type { WalletStatus } from '../lib/types';
import { checkMarket, checkPlaceParams, checkSendParams, checkTxid, DappError, DappErrors, DappMethods, dappPortName, type DappConnectInfo } from '../lib/dapp';
import type { MarketOrder } from '../lib/types';
import { approvalInfo, askUser, failApproval, finishApproval, rejectApproval, watchApprovalWindows } from '../lib/approvals';
import { addSite, isConnected, listSites, removeSite, sitesFor } from '../lib/sites';
import { isAddress, isRecipient, isReference } from '../lib/format';
import { checkMessageParams, checkSignInParams, messageText, signInText } from '../lib/signin';
import { checkSwapStep } from '../lib/swap-step';
import { cryptoRegisterAddress, fromHex, keyHash, signer, toHex } from '../lib/keys';

async function walletFor(node: NodeSettings): Promise<Wallet> {
  if (node.mode === 'local') {
    return new LocalWallet(node, await loadLocalKeys(node.url));
  }
  const s = await loadSession(node.url);
  return new Wallet(node, fetch, s?.id, s?.username);
}

async function wallet(): Promise<Wallet> {
  const node = await loadNode();
  if (!node) {
    throw new NexusError(-1010, 'No node set up yet');
  }
  return walletFor(node);
}

async function refuseSharedLogin() {
  const node = await loadNode();
  if (node && isSharedLogin(node, await (await walletFor(node)).info())) {
    throw new NexusError(sharedLoginCode, 'This node has one login for everyone who uses it, logging in here would let anyone use your account');
  }
}

async function status(node: NodeSettings | null): Promise<WalletStatus> {
  if (!node) {
    return { configured: false, node: null, nodeError: null, session: null };
  }
  const w = await walletFor(node);
  try {
    const info = await w.info();
    const session = await w.session();
    //a multi-user node forgets sessions (restart, timeout), then the stored one is useless
    if (info.multiuser && !session && (await loadSession(node.url))) {
      await clearSession();
    }
    return { configured: true, node: info, nodeError: null, session, remote: isRemote(node.url), sharedLogin: isSharedLogin(node, info), localMode: node.mode === 'local', nodeChange: await loadNodeChange() };
  } catch (e) {
    const err = e as NexusError;
    return { configured: true, node: null, nodeError: { code: err.code ?? -1, message: err.message }, session: null };
  }
}

//---- websites ----

type DappPort = ReturnType<typeof browser.runtime.connect>;
const dappPorts = new Set<{ port: DappPort; origin: string }>();

function portOrigin(port: DappPort): string | null {
  const s = port.sender as { origin?: string; url?: string; tab?: unknown; frameId?: number } | undefined;
  if (!s?.tab || s.frameId) {
    return null;
  }
  try {
    //an opaque origin (sandboxed page) is no site, the URL would wrongly give it the host's origin
    if (s.origin === 'null') {
      return null;
    }
    const origin = s.origin ?? new URL(s.url ?? '').origin;
    return /^https?:\/\//.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

//what a connected site may know about the user
async function siteView(): Promise<DappConnectInfo | null> {
  const w = await wallet();
  const session = await w.session();
  if (!session) {
    return null;
  }
  const accounts = await w.accounts();
  return {
    genesis: session.genesis,
    username: session.username,
    accounts: accounts.map((a) => ({ address: a.address, name: a.name ?? null, type: a.type, token: a.token, ticker: a.ticker ?? null })),
  };
}

//requests that open a window may come while locked, the window unlocks first; silent reads may not
//gives the account too, approvals are tied to it
async function requireSite(origin: string, opensWindow = false): Promise<{ w: Wallet; genesis: string }> {
  //a site never connected learns nothing, not even whether someone is logged in
  if (!(await listSites()).some((s) => s.origin === origin)) {
    throw new DappError(DappErrors.Unauthorized, 'Call nexus_connect first');
  }
  const w = await wallet();
  const session = await w.session();
  if (!session || !(await isConnected(origin, session.genesis))) {
    throw new DappError(DappErrors.Unauthorized, 'Call nexus_connect first');
  }
  if (!opensWindow && (await isLocked())) {
    throw new DappError(DappErrors.Disconnected, 'The wallet is locked');
  }
  return { w, genesis: session.genesis };
}

async function handleDapp(origin: string, method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case DappMethods.GetNetwork: {
      const info = await (await wallet()).info();
      return {
        network: info.private ? 'private' : info.testnet ? 'testnet' : 'mainnet',
        blocks: info.blocks,
        synchronized: info.synchronized,
      };
    }
    case DappMethods.Connect: {
      //the window also unlocks or logs in first when needed
      const before = await siteView();
      if (!before || !(await isConnected(origin, before.genesis)) || (await isLocked())) {
        //the window gives back the account the user approved (they may have logged in inside it)
        const approved = (await askUser('connect', origin)) as { genesis: string };
        const now = await siteView();
        if (!now || now.genesis !== approved.genesis) {
          throw new DappError(DappErrors.Disconnected, 'The account changed, connect again');
        }
        await addSite(origin, now.genesis);
        return now;
      }
      return before;
    }
    case DappMethods.Disconnect: {
      const s = await (await wallet()).session().catch(() => null);
      if (s) {
        await removeSite(origin, s.genesis);
      }
      return true;
    }
    case DappMethods.GetAccounts:
      await requireSite(origin);
      return (await siteView())?.accounts ?? [];
    case DappMethods.GetBalances: {
      const { w } = await requireSite(origin);
      return w.balances();
    }
    case DappMethods.Send: {
      const p = checkSendParams(params, isRecipient, isReference);
      const { genesis } = await requireSite(origin, true);
      return askUser('send', origin, { params: p, genesis });
    }
    case DappMethods.GetAssets: {
      const { w } = await requireSite(origin);
      return (await w.assets()).map(({ address, name, type, form, created, modified, owner, ...fields }) => ({ address, name: name ?? null, type, form: form ?? null, created, modified, owner, fields }));
    }
    case DappMethods.PayInvoice: {
      const p = (params ?? {}) as Record<string, unknown>;
      if (typeof p.address !== 'string' || !isAddress(p.address)) {
        throw new DappError(DappErrors.InvalidParams, 'address must be the register address of the invoice');
      }
      const { w, genesis } = await requireSite(origin, true);
      const inv = await w.invoice(p.address).catch(() => null);
      if (!inv) {
        throw new DappError(DappErrors.InvalidParams, 'invoice not found');
      }
      return askUser('invoice', origin, { invoice: p.address, genesis });
    }
    case DappMethods.GetOrders: {
      //the order book is public, no connect needed
      const market = checkMarket((params as { market?: unknown })?.market);
      return (await wallet()).marketOrders(market);
    }
    case DappMethods.GetMyOrders: {
      const market = checkMarket((params as { market?: unknown })?.market);
      const { w } = await requireSite(origin);
      const [a, b] = market.split('/') as [string, string];
      return w.myOrders([a, b]);
    }
    case DappMethods.FillOrder:
    case DappMethods.CancelOrder: {
      const p = (params ?? {}) as { market?: unknown; txid?: unknown };
      const market = checkMarket(p.market);
      const txid = checkTxid(p.txid);
      const { w, genesis } = await requireSite(origin, true);
      let found: MarketOrder | undefined;
      if (method === DappMethods.FillOrder) {
        const book = await w.marketOrders(market);
        found = [...book.bids, ...book.asks].find((o) => o.txid.toLowerCase() === txid);
      } else {
        const [a, b] = market.split('/') as [string, string];
        found = (await w.myOrders([a, b])).find((o) => o.txid.toLowerCase() === txid);
      }
      if (!found) {
        throw new DappError(DappErrors.InvalidParams, method === DappMethods.FillOrder ? 'no open order with this txid in that market' : 'no own open order with this txid in that market');
      }
      return askUser('order', origin, { order: { action: method === DappMethods.FillOrder ? 'fill' : 'cancel', market, found }, genesis });
    }
    case DappMethods.PlaceOrder: {
      const market = checkMarket((params as { market?: unknown })?.market);
      const p = checkPlaceParams(params);
      const { genesis } = await requireSite(origin, true);
      return askUser('order', origin, { order: { action: 'place', market, ...p }, genesis });
    }
    case DappMethods.SignIn:
    case DappMethods.SignMessage: {
      let text: (who: Parameters<typeof signInText>[0]) => string;
      try {
        if (method === DappMethods.SignIn) {
          const p = checkSignInParams(params);
          text = (who) => signInText(who, p, new Date());
        } else {
          const m = checkMessageParams(params);
          text = (who) => messageText(who, m);
        }
      } catch (e) {
        throw new DappError(DappErrors.InvalidParams, (e as Error).message);
      }
      const { w, genesis } = await requireSite(origin, true);
      const [session, info] = await Promise.all([w.session(), w.info()]);
      const network = info.private ? 'private' : info.testnet ? 'testnet' : 'mainnet';
      return askUser('sign', origin, { text: text({ origin, username: session!.username, genesis: session!.genesis, network }), genesis });
    }
    case DappMethods.SwapStep: {
      const step = checkSwapStep(params);
      const node = await loadNode();
      if (node?.mode !== 'local') {
        throw new DappError(DappErrors.Unsupported, 'Swaps need the wallet to sign in this browser (wallet settings)');
      }
      const { w, genesis } = await requireSite(origin, true);
      //checked against the chain before any window opens; a step that cannot work is refused right away
      let shown;
      try {
        shown = await w.swapPreview(step);
      } catch (e) {
        throw new DappError(DappErrors.InvalidParams, (e as Error).message);
      }
      return askUser('swap', origin, { swap: { step, shown }, genesis });
    }
    default:
      throw new DappError(DappErrors.Unsupported, `Unknown method ${method}`);
  }
}

//tells the sites connected for that account when it logs in or out
async function notifySites(genesis: string | undefined, event: string, data: unknown) {
  if (!genesis) {
    return;
  }
  const sites = await sitesFor(genesis);
  for (const { port, origin } of dappPorts) {
    if (sites.has(origin)) {
      try {
        port.postMessage({ event, data });
      } catch {
        //tab closed in between
      }
    }
  }
}

//node errors can name the node address: only a connected site of an unlocked wallet gets their text
async function errorOf(e: unknown, origin: string) {
  if (e instanceof DappError) {
    return { code: e.code, message: e.message };
  }
  let trusted = false;
  try {
    const s = await (await wallet()).session();
    trusted = !!s && (await isConnected(origin, s.genesis)) && !(await isLocked());
  } catch {
    trusted = false;
  }
  return { code: DappErrors.Internal, message: trusted ? (e as Error)?.message || String(e) : 'The wallet could not do this right now' };
}

//---- extension pages ----

const lockedCode = -1020;
//what the auth key signs to unlock, so the signature means nothing anywhere else
const unlockPrefix = 'nexus-wallet-unlock:';

//sites of the account that is logged in now
async function currentSites() {
  const s = await (await wallet()).session().catch(() => null);
  return s ? (await listSites()).filter((x) => x.genesis === s.genesis) : [];
}
//a challenge for the password unlock is good for this long
const challengeMs = 120000;
let unlockChallenge: { value: string; at: number } | null = null;
const needPasswordCode = -1021;
const sharedLoginCode = -1034;

//takes a file made by exportSettings, checks every field before saving
//a file could point the wallet at someone else's node or connect sites unseen, so the node comes back to
//the core settings form for the user to check and connect, and sites are never imported (they ask again)
async function importSettings(raw: unknown): Promise<{ node: NodeSettings | null; contacts: number }> {
  const d = (raw ?? {}) as Record<string, any>;
  if (d.format !== 'nexus-wallet-settings' || d.version !== 1) {
    throw new NexusError(-1030, 'This is not a Nexus Wallet settings file');
  }
  if (typeof d.lang === 'string' && ['en', 'hr'].includes(d.lang)) {
    await saveLang(d.lang);
  }
  //a file may not turn the auto lock off
  if (lockChoices.includes(d.lockMinutes) && d.lockMinutes !== 0) {
    await setLockMinutes(d.lockMinutes);
  }
  if (isExplorerUrl(d.explorer)) {
    await saveExplorer(d.explorer);
  }
  const contacts = await importContacts(d.contacts);
  if (!d.node || typeof d.node.url !== 'string') {
    return { node: null, contacts };
  }
  const old = await loadNode();
  const url = normalizeUrl(d.node.url);
  //the saved API password stays with the address it belongs to
  const keep = old && old.url === url ? old.password : '';
  return { node: { url, user: String(d.node.user ?? ''), password: typeof d.node.password === 'string' ? d.node.password : keep }, contacts };
}

//tests a core first and keeps the old settings when the new one does not answer
async function applyNode(input: NodeSettings, old: NodeSettings | null) {
  const node = withSafeMode(input);
  const before = old ? await (await walletFor(old)).session().catch(() => null) : null;
  const st = await status(node);
  if (st.nodeError && !st.node) {
    throw new NexusError(st.nodeError.code, st.nodeError.message);
  }
  //the PIN typed for one profile does not unlock another one
  if (old && st.session && st.session.genesis !== before?.genesis) {
    await lockNow();
  }
  if (old && before && before.genesis !== st.session?.genesis) {
    notifySites(before.genesis, 'accountsChanged', null);
  }
  if (old && old.url !== node.url) {
    await setNodeChange({ from: old.url, to: node.url, at: Math.floor(Date.now() / 1000) });
  }
  await saveNode(node);
  return st;
}

//requests that work while the wallet is locked
const openWhileLocked = new Set(['status', 'resetNode', 'signHere', 'unlock', 'unlockChallenge', 'unlockVerified', 'cryptoRegister', 'approvalGet', 'approvalReject', 'lock', 'login', 'createProfile', 'recoverProfile', 'getSettings', 'localNetwork', 'submitGenesis', 'profileExists']);

async function handle(msg: Message): Promise<unknown> {
  //the first setup has nothing to protect yet
  const firstSetup = (msg.type === 'getNode' || msg.type === 'saveNode') && !(await loadNode());
  if (!openWhileLocked.has(msg.type) && !firstSetup) {
    if (await isLocked()) {
      throw new NexusError(lockedCode, 'The wallet is locked');
    }
  }
  switch (msg.type) {
    case 'status':
      return { ...(await status(await loadNode())), locked: await isLocked() };
    case 'lock':
      await lockNow();
      return null;
    //clicks and keys in our pages, timed refreshes do not count as activity
    case 'touch':
      await touch();
      return null;
    case 'unlock': {
      //the core checks the PIN where it can (sessions/validate/pin is missing in 5.1.4)
      let ok: unknown;
      try {
        ok = await (await wallet()).validatePin(msg.pin);
      } catch (e) {
        const code = (e as NexusError).code;
        if (code === ErrorCodes.NotSupported || code === ErrorCodes.BadAnswer) {
          throw new NexusError(needPasswordCode, 'This core cannot check the PIN alone, enter your password too');
        }
        throw e;
      }
      if (ok !== true) {
        throw new NexusError(-1022, 'Wrong PIN');
      }
      await touch();
      return null;
    }
    case 'unlockChallenge':
      unlockChallenge = { value: toHex(crypto.getRandomValues(new Uint8Array(32))), at: Date.now() };
      return unlockChallenge.value;
    case 'unlockVerified': {
      //the page made the auth key from password and PIN and signed our challenge with it
      const c = unlockChallenge;
      unlockChallenge = null;
      if (!c || Date.now() - c.at > challengeMs) {
        throw new NexusError(-1023, 'The unlock took too long, try again');
      }
      const w = await wallet();
      const s = await w.session();
      const reg = s ? await w.cryptoRegister(cryptoRegisterAddress(s.genesis)) : null;
      let ok = false;
      try {
        const pub = fromHex(msg.publicKey);
        ok = !!reg && keyHash(pub).toLowerCase() === reg.auth.toLowerCase() && signer.verify(fromHex(msg.signature), new TextEncoder().encode(unlockPrefix + c.value), pub, { format: 'der', lowS: false });
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new NexusError(-1022, 'Password or PIN is not right for this account');
      }
      await touch();
      return null;
    }
    case 'getSettings':
      return { lockMinutes: await lockMinutes() };
    case 'setLockMinutes':
      await setLockMinutes(msg.minutes);
      return null;
    case 'exportSettings': {
      const node = await loadNode();
      return {
        format: 'nexus-wallet-settings',
        version: 1,
        exported: new Date().toISOString(),
        //the API password never leaves the background, a file can be copied anywhere
        node: node ? { url: node.url, user: node.user } : null,
        lang: await loadLang(),
        lockMinutes: await lockMinutes(),
        sites: [...(await currentSites())],
        contacts: (await listContacts()).map(({ name, to, note }) => ({ name, to, note })),
        explorer: (await loadExplorer()) === defaultExplorer ? undefined : await loadExplorer(),
      };
    }
    case 'importSettings':
      return importSettings(msg.data);
    case 'getNode': {
      //pages get the address and user, never the saved API password
      const node = await loadNode();
      return node ? { url: node.url, user: node.user, password: '', hasPassword: !!node.password, mode: node.mode, index: node.index } : null;
    }
    case 'saveNode': {
      const old = await loadNode();
      const url = normalizeUrl(msg.node.url);
      //an empty password field keeps the saved one, but only for the same address
      const known = (await loadSavedNodes()).find((n) => sameNode(n, { url, user: msg.node.user.trim() }));
      const node = { ...msg.node, url, password: msg.node.password || (old && old.url === url ? old.password : (known?.password ?? '')) };
      return applyNode(node, old);
    }
    //same node and API login, only the login stays in this browser: allowed while locked, it can only show the node less
    case 'signHere': {
      const node = await loadNode();
      if (!node) {
        throw new NexusError(-1010, 'No node set up yet');
      }
      return applyNode({ ...node, mode: 'local' }, node);
    }
    case 'savedNodes': {
      const current = await loadNode();
      //pages get address and user, never the API password
      return (await loadSavedNodes()).map((n) => ({ url: n.url, user: n.user, current: !!current && sameNode(n, current) }));
    }
    case 'switchNode': {
      const node = (await loadSavedNodes()).find((n) => sameNode(n, msg));
      if (!node) {
        throw new NexusError(-1032, 'This core is not saved any more');
      }
      return applyNode(node, await loadNode());
    }
    case 'removeSavedNode': {
      const current = await loadNode();
      if (current && sameNode(current, msg)) {
        throw new NexusError(-1033, 'This is the core in use, switch to another one first');
      }
      await removeSavedNode(msg.url, msg.user);
      return null;
    }
    case 'resetNode': {
      //way out of a locked wallet whose core is gone: forget the core, shows nothing of the old settings
      const node = await loadNode();
      if (node && (await status(node)).node) {
        throw new NexusError(-1031, 'The core answers, unlock the wallet instead');
      }
      await clearSession();
      await forgetNode();
      await clearLocalKeys();
      return null;
    }
    case 'login': {
      await refuseSharedLogin();
      const node = await loadNode();
      const s = await (await wallet()).login(msg.username, msg.password, msg.pin);
      if (s.session && node) {
        await saveSession({ node: node.url, id: s.session, username: s.username, genesis: s.genesis });
      }
      await touch();
      await setNodeChange(null);
      notifySites(s.genesis, 'accountsChanged', await siteView().catch(() => null));
      //the session id stays in the background
      return { genesis: s.genesis, username: s.username };
    }
    case 'logout': {
      const w = await wallet();
      const before = await w.session().catch(() => null);
      await w.logout(msg.pin);
      await clearSession();
      notifySites(before?.genesis, 'accountsChanged', null);
      return null;
    }
    case 'createProfile':
      await refuseSharedLogin();
      return { txid: await (await wallet()).createProfile(msg.username, msg.password, msg.pin) };
    case 'recoverProfile':
      await refuseSharedLogin();
      return { txid: await (await wallet()).recoverProfile(msg.username, msg.recovery, msg.password, msg.pin) };
    case 'updateCredentials':
      return { txid: await (await wallet()).updateCredentials(msg.pin, msg.newPassword, msg.newPin) };
    case 'updateRecovery':
      return { txid: await (await wallet()).updateRecovery(msg.pin, msg.newRecovery, msg.recovery) };
    case 'balances':
      return (await wallet()).balances();
    case 'accounts':
      return (await wallet()).accounts();
    case 'transactions':
      return (await wallet()).transactions(msg.limit, msg.page);
    case 'notifications':
      return (await wallet()).notifications();
    case 'send':
      return { txid: await (await wallet()).send(msg) };
    case 'claim':
      return { txid: await (await wallet()).claim(msg.txid, msg.pin) };
    case 'localNetwork': {
      //user type byte of genesis ids (TAO/Ledger/include/enum.h): private chains run as hybrid testnets, network id ""
      const info = await (await wallet()).info();
      if (info.private) {
        return { userType: 'b7', hybrid: '' };
      }
      if ((info as { hybrid?: boolean }).hybrid) {
        throw new NexusError(ErrorCodes.NotSupported, 'New profiles on hybrid networks are not supported yet');
      }
      return { userType: info.testnet ? 'b1' : 'a1' };
    }
    //public on chain: a profile exists when its crypto register does
    case 'profileExists':
      return !!(await (await wallet()).cryptoRegister(cryptoRegisterAddress(msg.genesis)));
    case 'submitGenesis': {
      //only a first transaction, and only in the mode that signs here
      const node = await loadNode();
      if (node?.mode !== 'local' || parseTx(msg.data).sequence !== 0) {
        throw new NexusError(-1041, 'Not a new profile');
      }
      const r = await (await wallet()).submitRaw(msg.data);
      if (r !== msg.txid) {
        throw new NexusError(-150, 'The node did not take the new profile');
      }
      return null;
    }
    case 'claimAll': {
      //signing here: all claims in one transaction (the next one could only follow after a block)
      const w = await wallet();
      if (w instanceof LocalWallet) {
        return { txid: await w.claimAll(msg.txids, msg.pin) };
      }
      let txid = '';
      for (const t of msg.txids) {
        txid = await w.claim(t, msg.pin);
      }
      return { txid };
    }
    case 'createRegister': {
      const w = await wallet();
      switch (msg.kind) {
        case 'account':
          return w.createAccount(msg.name, msg.token, msg.pin);
        case 'token':
          return w.createToken(msg.name, msg.supply, msg.decimals, msg.pin);
        case 'name':
          return w.createName(msg.name, msg.register, msg.global, msg.pin);
        case 'asset':
          return w.createAsset(msg.name, msg.fields, msg.pin);
      }
      throw new NexusError(-1012, 'Unknown register kind');
    }
    case 'voidTx':
      return { txid: await (await wallet()).voidTx(msg.txid, msg.pin) };
    case 'claimAsset':
      return { txid: await (await wallet()).claimAsset(msg.txid, msg.pin) };
    case 'stakeInfo':
      return (await wallet()).stakeInfo();
    case 'setStake':
      return { txid: await (await wallet()).setStake(msg.amount, msg.pin) };
    case 'setStaking':
      await (await wallet()).setStaking(msg.on, msg.pin);
      return null;
    case 'assets':
      return (await wallet()).assets();
    case 'marketOrders':
      return (await wallet()).marketOrders(msg.market);
    case 'myOrders':
      return (await wallet()).myOrders(msg.tokens);
    case 'createOrder':
      return { txid: await (await wallet()).createOrder({ type: msg.order, market: msg.market, amount: msg.amount, price: msg.price, from: msg.from, to: msg.to, pin: msg.pin }) };
    case 'executeOrder':
      return { txid: await (await wallet()).executeOrder(msg.txid, msg.from, msg.to, msg.pin) };
    case 'cancelOrder':
      return { txid: await (await wallet()).cancelOrder(msg.txid, msg.pin) };
    case 'transferAsset':
      return { txid: await (await wallet()).transferAsset(msg.address, msg.recipient, msg.pin) };
    case 'invoices':
      return (await wallet()).invoices();
    case 'invoice':
      return (await wallet()).invoice(msg.address);
    case 'payInvoice':
      return { txid: await (await wallet()).payInvoice(msg.address, msg.from, msg.pin) };
    case 'createInvoice':
      return (await wallet()).createInvoice(msg);
    case 'cancelInvoice':
      return { txid: await (await wallet()).cancelInvoice(msg.address, msg.pin) };
    case 'rejectInvoice':
      return { txid: await (await wallet()).rejectInvoice(msg.address, msg.pin) };
    case 'approvalGet':
      return approvalInfo(msg.id);
    case 'approvalDone': {
      //a request belongs to the account it was made for; connect learns here which account was approved
      const info = approvalInfo(msg.id);
      const s = await (await wallet()).session();
      if (!s || (info.genesis && info.genesis !== s.genesis)) {
        failApproval(msg.id, new DappError(DappErrors.Disconnected, 'The account changed, the request was cancelled'));
        return null;
      }
      finishApproval(msg.id, info.kind === 'connect' ? { genesis: s.genesis } : msg.result);
      return null;
    }
    case 'approvalReject':
      rejectApproval(msg.id);
      return null;
    case 'approvalSwap': {
      const info = approvalInfo(msg.id);
      const w = await wallet();
      const s = await w.session();
      if (info.kind !== 'swap' || !info.swap || !s || info.genesis !== s.genesis) {
        throw new NexusError(-43, 'This request is no longer open');
      }
      return { txid: await w.swapStep(info.swap.step, msg.pin) };
    }
    case 'sites':
      return [...(await currentSites())];
    case 'cryptoRegister': {
      const w = await wallet();
      const s = await w.session();
      if (!s) {
        return null;
      }
      const address = cryptoRegisterAddress(s.genesis);
      const reg = await w.cryptoRegister(address);
      return reg ? { address, ...reg } : null;
    }
    case 'removeSite': {
      const s = await (await wallet()).session().catch(() => null);
      if (s) {
        await removeSite(msg.origin, s.genesis);
      }
      for (const { port, origin } of dappPorts) {
        if (origin === msg.origin) {
          port.postMessage({ event: 'disconnect', data: null });
        }
      }
      return null;
    }
    default:
      throw new NexusError(-1012, 'Unknown request');
  }
}

const badgeAlarm = 'incoming';
//requests after which the incoming count may have changed
const badgeAfter = new Set(['login', 'logout', 'lock', 'resetNode', 'claim', 'claimAsset', 'saveNode', 'switchNode', 'unlock', 'unlockVerified']);

//a locked wallet shows no number and does not ask the core (it would keep a multi-user session alive)
async function updateBadge() {
  try {
    if (await isLocked()) {
      await setBadge(0);
      return;
    }
    const node = await loadNode();
    await refreshBadge(node ? await walletFor(node) : null);
  } catch {
    //no core or no settings yet, the badge stays as it is
  }
}

export default defineBackground(() => {
  watchApprovalWindows();
  browser.alarms.create(badgeAlarm, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === badgeAlarm) {
      updateBadge();
    }
  });
  updateBadge();

  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    //only our own pages, websites come through their port
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/'))) {
      return false;
    }
    handle(msg as Message)
      .then((data) => {
        if (badgeAfter.has((msg as Message).type)) {
          updateBadge();
        }
        sendResponse({ ok: true, data } satisfies Reply<unknown>);
      })
      .catch((e) =>
        sendResponse({
          ok: false,
          error: { code: (e as NexusError).code ?? -1, message: (e as Error).message || String(e) },
        } satisfies Reply<unknown>),
      );
    return true;
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== dappPortName) {
      return;
    }
    const origin = portOrigin(port);
    if (!origin) {
      port.disconnect();
      return;
    }
    const entry = { port, origin };
    dappPorts.add(entry);
    port.onDisconnect.addListener(() => dappPorts.delete(entry));
    port.onMessage.addListener((msg: any) => {
      if (typeof msg?.id !== 'number' || typeof msg?.method !== 'string') {
        return;
      }
      handleDapp(origin, msg.method, msg.params)
        .then((result) => port.postMessage({ id: msg.id, result }))
        .catch(async (e) => {
          const error = await errorOf(e, origin);
          try {
            port.postMessage({ id: msg.id, error });
          } catch {
            //page gone
          }
        });
    });
  });
});
