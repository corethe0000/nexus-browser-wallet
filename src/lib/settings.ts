import { defaultNode, normalizeUrl, type NodeSettings } from './node';
import type { NodeInfo } from './types';

const nodeKey = 'node';
//every core this wallet connected to, with its API password, read only by the background
const savedNodesKey = 'savedNodes';
const maxSavedNodes = 10;
const langKey = 'lang';

export async function loadNode(): Promise<NodeSettings | null> {
  const got = await browser.storage.local.get(nodeKey);
  const node = got[nodeKey] as NodeSettings | undefined;
  return node?.url ? { ...defaultNode, ...node } : null;
}

export async function saveNode(node: NodeSettings): Promise<NodeSettings> {
  const clean: NodeSettings = { url: normalizeUrl(node.url), user: node.user.trim(), password: node.password };
  if (node.mode === 'local') {
    clean.mode = 'local';
    if (node.index?.trim()) {
      clean.index = normalizeUrl(node.index);
    }
  }
  const others = (await loadSavedNodes()).filter((n) => !sameNode(n, clean));
  await browser.storage.local.set({ [nodeKey]: clean, [savedNodesKey]: [clean, ...others].slice(0, maxSavedNodes) });
  return clean;
}

export const sameNode = (a: { url: string; user: string }, b: { url: string; user: string }) => a.url === b.url && a.user === b.user;

//newest first
export async function loadSavedNodes(): Promise<NodeSettings[]> {
  const got = await browser.storage.local.get([savedNodesKey, nodeKey]);
  const saved = got[savedNodesKey] as NodeSettings[] | undefined;
  const list = Array.isArray(saved) ? saved.filter((n) => n?.url) : [];
  //a wallet from before the saved list keeps its core
  const current = got[nodeKey] as NodeSettings | undefined;
  return current?.url && !list.some((n) => sameNode(n, current)) ? [{ ...defaultNode, ...current }, ...list] : list;
}

export async function removeSavedNode(url: string, user: string): Promise<void> {
  const list = (await loadSavedNodes()).filter((n) => !sameNode(n, { url, user }));
  await browser.storage.local.set({ [savedNodesKey]: list });
}

export async function loadLang(): Promise<string | null> {
  const got = await browser.storage.local.get(langKey);
  return (got[langKey] as string) || null;
}

export async function saveLang(lang: string): Promise<void> {
  await browser.storage.local.set({ [langKey]: lang });
}

//offered on the setup page; the public ones are Nexus seed nodes, node1 multi-user and node3 single-user
//(checked 2026-11-17), so only with sign in this browser
export interface SuggestedNode {
  node: NodeSettings;
  kind: 'desktop' | 'public';
}

export const suggestedNodes: SuggestedNode[] = [
  { node: defaultNode, kind: 'desktop' },
  { node: { url: 'http://node1.nexus.io:8080', user: '', password: '', mode: 'local' }, kind: 'public' },
  { node: { url: 'http://node3.nexus.io:8080', user: '', password: '', mode: 'local' }, kind: 'public' },
];

//host permission pattern for a node url, null when the manifest already covers it
export function nodeOrigin(url: string): string | null {
  const u = new URL(normalizeUrl(url));
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
    return null;
  }
  return `${u.protocol}//${u.hostname}/*`;
}

//also the saved list: a locked wallet must not reach a saved core through the reset
export async function forgetNode(): Promise<void> {
  await browser.storage.local.remove([nodeKey, savedNodesKey]);
}

//last change of the core address, shown at the next login until someone logs in
const nodeChangeKey = 'nodeChange';

export interface NodeChange {
  from: string;
  to: string;
  at: number;
}

export async function loadNodeChange(): Promise<NodeChange | null> {
  const got = await browser.storage.local.get(nodeChangeKey);
  return (got[nodeChangeKey] as NodeChange | undefined) ?? null;
}

export async function setNodeChange(c: NodeChange | null): Promise<void> {
  if (c) {
    await browser.storage.local.set({ [nodeChangeKey]: c });
  } else {
    await browser.storage.local.remove(nodeChangeKey);
  }
}

//node on another computer: its operator sees every login typed into the wallet
export function isRemote(url: string): boolean {
  try {
    return !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return true;
  }
}

//explorer for transaction links, the official one unless the user picks another
const explorerKey = 'explorerUrl';
export const defaultExplorer = 'https://explorer.nexus.io';

export async function loadExplorer(): Promise<string> {
  const got = await browser.storage.local.get(explorerKey);
  return (got[explorerKey] as string | undefined) || defaultExplorer;
}

//only web addresses, a file could carry anything
export function isExplorerUrl(url: unknown): url is string {
  try {
    return typeof url === 'string' && ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export async function saveExplorer(url: string): Promise<void> {
  const u = normalizeUrl(url || defaultExplorer);
  await browser.storage.local.set({ [explorerKey]: isExplorerUrl(u) ? u : defaultExplorer });
}

//on a single-user node every API caller works with the one logged in profile; without an API login anyone on
//the internet is such a caller, so a login there hands the account to everyone
export function isSharedLogin(node: NodeSettings, info: Pick<NodeInfo, 'multiuser'>): boolean {
  return node.mode !== 'local' && isRemote(node.url) && !info.multiuser && !node.user;
}
