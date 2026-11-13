//the newest blocks of a node, for finding payments to claim without an index (the wallet's no-login mode and the
//Nexus DEX). A node started without -indexheight ignores `page` (every page is the newest one): older blocks then
//come one by one along previousblockhash; those never change and are kept.
export type BlockCall = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

const pageSize = 100;
//payments to claim are looked for in this many newest blocks
export const scanBlocks = 300;
//the newest blocks are read once for the payments and the registers of one refresh
const blockCacheMs = 15000;
let recentCache: { node: string; at: number; blocks: any[] } | null = null;
//blocks read one by one along previousblockhash, by node and hash
const walkedBlocks = new Map<string, any>();
const maxWalkedBlocks = 1000;

//newest first; node = a key for the node (its URL), so caches of two nodes never mix
export async function recentBlocks(call: BlockCall, node: string): Promise<any[]> {
  if (recentCache?.node === node && Date.now() - recentCache.at < blockCacheMs) {
    return recentCache.blocks;
  }
  const out: any[] = [];
  const heights = new Set<number>();
  for (let page = 0; out.length < scanBlocks; page++) {
    const blocks = (await call<any[]>('ledger/list/blocks', { limit: pageSize, page, verbose: 'detail' }).catch(() => [])) ?? [];
    const fresh = blocks.filter((b) => !heights.has(b.height));
    for (const b of fresh) {
      heights.add(b.height);
      out.push(b);
    }
    if (blocks.length < pageSize) {
      break;
    }
    if (fresh.length === 0) {
      let b = out[out.length - 1];
      while (out.length < scanBlocks && b?.previousblockhash && b.height > 1) {
        const key = `${node}|${b.previousblockhash}`;
        b = walkedBlocks.get(key) ?? (await call<any>('ledger/get/block', { hash: b.previousblockhash, verbose: 'detail' }).catch(() => null));
        if (!b) {
          break;
        }
        walkedBlocks.set(key, b);
        out.push(b);
      }
      break;
    }
  }
  while (walkedBlocks.size > maxWalkedBlocks) {
    walkedBlocks.delete(walkedBlocks.keys().next().value!);
  }
  recentCache = { node, at: Date.now(), blocks: out };
  return out;
}
