//talks to the HTTP API of a Nexus core (LLL-TAO), the one inside the desktop wallet or any other node

export interface NodeSettings {
  url: string;
  user: string;
  password: string;
  //'local' = sign in this browser: no login on the node, transactions are signed in the extension
  mode?: 'local';
  //explorer backend with /explorer/incoming, where a 'local' wallet finds payments to claim
  index?: string;
}

export const defaultNode: NodeSettings = {
  url: 'http://127.0.0.1:8080',
  user: 'apiserver',
  password: '',
};

//codes we use for errors that do not come from the node
export const ErrorCodes = {
  Unreachable: -1001,
  AuthRefused: -1002,
  Timeout: -1003,
  BadAnswer: -1004,
  NotSupported: -1005,
} as const;

export class NexusError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'NexusError';
    this.code = code;
  }
}

//sessions/create can take 20 s on a busy node
const callTimeoutMs = 60000;

//the node colors some messages for its terminal
const ansiPattern = /\u001b\[[0-9;]*m/g;

export function cleanMessage(message: unknown): string {
  return String(message ?? '').replace(ansiPattern, '').trim();
}

export function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) {
    u = 'http://' + u;
  }
  return u.replace(/\/+$/, '');
}

export async function callNode<T = any>(
  node: NodeSettings,
  method: string,
  params: Record<string, unknown> = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (node.user || node.password) {
    headers.Authorization = 'Basic ' + btoa(`${node.user}:${node.password}`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), callTimeoutMs);
  let res: Response;
  try {
    res = await fetcher(`${normalizeUrl(node.url)}/${method}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new NexusError(ErrorCodes.Timeout, `The node did not answer ${method} in time`);
    }
    throw new NexusError(ErrorCodes.Unreachable, `Cannot reach the node at ${normalizeUrl(node.url)}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new NexusError(ErrorCodes.AuthRefused, 'The node refused the API user or password');
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new NexusError(ErrorCodes.BadAnswer, `The node answered ${method} with HTTP ${res.status} and no JSON`);
  }

  if (body?.error) {
    const message = cleanMessage(body.error.message);
    //older cores lack some commands (5.1.4 in the desktop wallet has no invoices/reject)
    if (/^Method not found/i.test(message) || /^API Not Found/i.test(message)) {
      throw new NexusError(ErrorCodes.NotSupported, `This core version does not support ${method}, a newer core is needed`);
    }
    throw new NexusError(Number(body.error.code) || ErrorCodes.BadAnswer, message);
  }
  if (!res.ok) {
    throw new NexusError(ErrorCodes.BadAnswer, `The node answered ${method} with HTTP ${res.status}`);
  }
  return body?.result as T;
}
