//runs in the page itself and gives websites window.nexus, talks to our content script with window messages
export default defineUnlistedScript(() => {
  const channel = 'nexus-wallet';
  const w = window as unknown as Record<string, unknown>;
  if (w.nexus) {
    return;
  }

  type Listener = (data: unknown) => void;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Map<string, Set<Listener>>();

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data;
    if (e.source !== window || !d || d.channel !== channel || d.dir !== 'to-page') {
      return;
    }
    if (typeof d.event === 'string') {
      listeners.get(d.event)?.forEach((fn) => {
        try {
          fn(d.data);
        } catch (err) {
          console.error(err);
        }
      });
      return;
    }
    const p = pending.get(d.id);
    if (!p) {
      return;
    }
    pending.delete(d.id);
    if (d.error) {
      const err = new Error(d.error.message) as Error & { code: number };
      err.code = d.error.code;
      p.reject(err);
    } else {
      p.resolve(d.result);
    }
  });

  const provider = {
    isNexusWallet: true,
    request(args: { method: string; params?: unknown }): Promise<unknown> {
      if (!args || typeof args.method !== 'string') {
        return Promise.reject(Object.assign(new Error('request needs a method'), { code: -32602 }));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.postMessage({ channel, dir: 'to-wallet', id, method: args.method, params: args.params }, window.location.origin);
      });
    },
    on(event: string, fn: Listener) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(fn);
      return provider;
    },
    removeListener(event: string, fn: Listener) {
      listeners.get(event)?.delete(fn);
      return provider;
    },
  };

  Object.defineProperty(window, 'nexus', { value: Object.freeze(provider), writable: false, configurable: false });
  window.dispatchEvent(new Event('nexus#initialized'));
});
