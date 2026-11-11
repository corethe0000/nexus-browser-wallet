import { isClaimable } from './claims';
import type { Wallet } from './wallet';

//incoming payments and assets waiting to be claimed, as a number on the toolbar icon
const badgeColor = '#2f80ed';

//MV3 has browser.action, Firefox MV2 browser.browserAction
function action() {
  return (browser as unknown as { action?: typeof browser.action; browserAction?: typeof browser.action }).action ?? (browser as unknown as { browserAction: typeof browser.action }).browserAction;
}

export async function setBadge(count: number): Promise<void> {
  const a = action();
  if (!a) {
    return;
  }
  await a.setBadgeText({ text: count > 0 ? (count > 99 ? '99+' : String(count)) : '' });
  await a.setBadgeBackgroundColor({ color: badgeColor });
}

export async function refreshBadge(w: Wallet | null): Promise<void> {
  try {
    if (!w || !(await w.session())) {
      await setBadge(0);
      return;
    }
    const n = await w.notifications();
    await setBadge(n.filter((x) => isClaimable(x)).length);
  } catch {
    //the core is busy right after login or not there, keep the last number
  }
}
