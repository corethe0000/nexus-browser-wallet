//screen lock of the extension: after some idle minutes it hides the wallet and holds back site requests until
//the user gives the PIN again; the core is not logged out (that would log out the desktop wallet too)
const settingsKey = 'lock';
const activeKey = 'lastActive';

export const lockChoices = [0, 5, 15, 30, 60] as const;
export const defaultLockMinutes = 15;

//storage.session is memory only (gone when the browser closes), older Firefox may lack it
let memoryActive: number | null = null;

async function readActive(): Promise<number | null> {
  try {
    const got = await browser.storage.session.get(activeKey);
    return (got[activeKey] as number | undefined) ?? null;
  } catch {
    return memoryActive;
  }
}

async function writeActive(v: number | null): Promise<void> {
  memoryActive = v;
  try {
    if (v === null) {
      await browser.storage.session.remove(activeKey);
    } else {
      await browser.storage.session.set({ [activeKey]: v });
    }
  } catch {
    //memory copy is enough
  }
}

export async function lockMinutes(): Promise<number> {
  const got = await browser.storage.local.get(settingsKey);
  const v = got[settingsKey] as number | undefined;
  return typeof v === 'number' ? v : defaultLockMinutes;
}

export async function setLockMinutes(minutes: number): Promise<void> {
  await browser.storage.local.set({ [settingsKey]: minutes });
}

//no activity recorded yet (browser just started) counts as locked
//locked by hand is 0, it holds even with auto lock off
export async function isLocked(now = Date.now()): Promise<boolean> {
  const last = await readActive();
  if (last === 0) {
    return true;
  }
  const minutes = await lockMinutes();
  if (minutes === 0) {
    return false;
  }
  return last === null || now - last > minutes * 60000;
}

export async function touch(): Promise<void> {
  await writeActive(Date.now());
}

export async function lockNow(): Promise<void> {
  await writeActive(0);
}
