import { dappChannel, dappPortName, DappErrors } from '../lib/dapp';

//bridge between the page (window.nexus) and the background, the page never talks to the extension directly
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  async main() {
    //sandboxed pages have no origin of their own and are no site (Firefox gives the background no sender.origin)
    if (window.origin === 'null') {
      return;
    }
    await injectScript('/nexus-provider.js', { keepInDom: false });

    let port: ReturnType<typeof browser.runtime.connect> | null = null;
    const inFlight = new Set<number>();

    const toPage = (msg: Record<string, unknown>) => window.postMessage({ channel: dappChannel, dir: 'to-page', ...msg }, window.location.origin);

    function connect() {
      const p = browser.runtime.connect({ name: dappPortName });
      p.onMessage.addListener((msg: any) => {
        if (typeof msg?.id === 'number') {
          inFlight.delete(msg.id);
        }
        toPage(msg);
      });
      p.onDisconnect.addListener(() => {
        port = null;
        //the background restarted, open requests are lost
        for (const id of inFlight) {
          toPage({ id, error: { code: DappErrors.Disconnected, message: 'The wallet was restarted, try again' } });
        }
        inFlight.clear();
      });
      return p;
    }

    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data;
      if (e.source !== window || !d || d.channel !== dappChannel || d.dir !== 'to-wallet') {
        return;
      }
      if (typeof d.id !== 'number' || typeof d.method !== 'string') {
        return;
      }
      port = port ?? connect();
      inFlight.add(d.id);
      port.postMessage({ id: d.id, method: d.method, params: d.params });
    });
  },
});
