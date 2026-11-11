import { describe, expect, it } from 'vitest';
import { callNode, cleanMessage, ErrorCodes, NexusError, normalizeUrl } from './node';

const node = { url: 'http://127.0.0.1:8080/', user: 'apiserver', password: 'secret' };

function fakeFetch(status: number, body: unknown, seen?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    if (seen) {
      seen.url = url;
      seen.init = init;
    }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('callNode', () => {
  it('posts JSON with basic auth and returns result', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const r = await callNode(node, 'system/get/info', { a: 1 }, fakeFetch(200, { result: { blocks: 5 } }, seen));
    expect(r).toEqual({ blocks: 5 });
    expect(seen.url).toBe('http://127.0.0.1:8080/system/get/info');
    expect(seen.init?.body).toBe('{"a":1}');
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic ' + btoa('apiserver:secret'));
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws the node error with code and clean message', async () => {
    const err = await callNode(node, 'x', {}, fakeFetch(400, { error: { code: -11, message: '\u001b[1mSession\u001b[0m not found' } })).catch((e) => e);
    expect(err).toBeInstanceOf(NexusError);
    expect(err.code).toBe(-11);
    expect(err.message).toBe('Session not found');
  });

  it('says when the core is too old for a command', async () => {
    const err = await callNode(node, 'invoices/reject/invoice', {}, fakeFetch(400, { error: { code: -2, message: 'Method not found: reject' } })).catch((e) => e);
    expect(err.code).toBe(ErrorCodes.NotSupported);
    expect(err.message).toContain('invoices/reject/invoice');
  });

  it('reports refused API login', async () => {
    const err = await callNode(node, 'x', {}, fakeFetch(401, 'no')).catch((e) => e);
    expect(err.code).toBe(ErrorCodes.AuthRefused);
  });

  it('reports a node that cannot be reached', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const err = await callNode(node, 'x', {}, failing).catch((e) => e);
    expect(err.code).toBe(ErrorCodes.Unreachable);
  });

  it('reports an answer without JSON', async () => {
    const err = await callNode(node, 'x', {}, fakeFetch(500, '<html>')).catch((e) => e);
    expect(err.code).toBe(ErrorCodes.BadAnswer);
  });

  it('sends no auth header without user and password', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await callNode({ url: 'localhost:7080', user: '', password: '' }, 'a', {}, fakeFetch(200, { result: 1 }, seen));
    expect((seen.init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(seen.url).toBe('http://localhost:7080/a');
  });
});

describe('helpers', () => {
  it('normalizes urls', () => {
    expect(normalizeUrl(' 127.0.0.1:8080// ')).toBe('http://127.0.0.1:8080');
    expect(normalizeUrl('https://node.example:8443')).toBe('https://node.example:8443');
  });

  it('strips terminal colors', () => {
    expect(cleanMessage('\u001b[31;1mERROR\u001b[0m: x')).toBe('ERROR: x');
  });
});
