//background side: website requests that wait for the user in an approval window
import { DappError, DappErrors, type ApprovalDetails, type ApprovalInfo, type ApprovalKind } from './dapp';

interface Pending extends ApprovalInfo {
  resolve: (result: unknown) => void;
  reject: (e: unknown) => void;
  windowId?: number;
}

const windowWidth = 380;
const windowHeight = 640;

const pending = new Map<string, Pending>();

export function approvalInfo(id: string): ApprovalInfo {
  const p = pending.get(id);
  if (!p) {
    throw new DappError(DappErrors.Internal, 'This request is no longer open');
  }
  const { resolve: _r, reject: _j, windowId: _w, ...info } = p;
  return info;
}

export function finishApproval(id: string, result: unknown): void {
  const p = pending.get(id);
  if (!p) {
    throw new DappError(DappErrors.Internal, 'This request is no longer open');
  }
  pending.delete(id);
  p.resolve(result);
  closeWindow(p.windowId);
}

export function failApproval(id: string, error: unknown): void {
  const p = pending.get(id);
  if (p) {
    pending.delete(id);
    p.reject(error);
    closeWindow(p.windowId);
  }
}

export function rejectApproval(id: string): void {
  const p = pending.get(id);
  if (p) {
    pending.delete(id);
    p.reject(new DappError(DappErrors.UserRejected, 'The user rejected the request'));
    closeWindow(p.windowId);
  }
}

function closeWindow(windowId: number | undefined) {
  if (windowId !== undefined) {
    browser.windows.remove(windowId).catch(() => {});
  }
}

//closing the window counts as reject
export function watchApprovalWindows(): void {
  browser.windows.onRemoved.addListener((windowId) => {
    for (const p of pending.values()) {
      if (p.windowId === windowId) {
        pending.delete(p.id);
        p.reject(new DappError(DappErrors.UserRejected, 'The user closed the request'));
      }
    }
  });
}

export async function askUser(kind: ApprovalKind, origin: string, details: ApprovalDetails = {}): Promise<unknown> {
  //one open request per site, a page cannot stack windows
  for (const p of pending.values()) {
    if (p.origin === origin) {
      throw new DappError(DappErrors.Pending, 'A request from this site is already waiting for the user');
    }
  }
  const id = crypto.randomUUID();
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { ...details, id, kind, origin, resolve, reject });
  });
  try {
    const win = await browser.windows.create({
      url: `${browser.runtime.getURL('/approve.html')}?id=${id}`,
      type: 'popup',
      width: windowWidth,
      height: windowHeight,
      focused: true,
    });
    const p = pending.get(id);
    if (p) {
      p.windowId = win?.id;
    }
  } catch (e) {
    pending.delete(id);
    throw new DappError(DappErrors.Internal, 'Could not open the approval window');
  }
  return promise;
}
