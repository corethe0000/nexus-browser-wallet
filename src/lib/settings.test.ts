import { describe, expect, it } from 'vitest';
import { isRemote, isSharedLogin, nodeOrigin } from './settings';

describe('node address', () => {
  it('tells local from remote nodes', () => {
    expect(isRemote('http://127.0.0.1:8080')).toBe(false);
    expect(isRemote('http://localhost:7080')).toBe(false);
    expect(isRemote('http://[::1]:8080')).toBe(false);
    expect(isRemote('http://192.168.83.30:8080')).toBe(true);
    expect(isRemote('https://node.example')).toBe(true);
    expect(isRemote('not a url')).toBe(true);
  });

  it('asks host permission only for remote nodes', () => {
    expect(nodeOrigin('http://127.0.0.1:8080')).toBeNull();
    expect(nodeOrigin('192.168.83.30:8080')).toBe('http://192.168.83.30/*');
  });
});

describe('shared login nodes', () => {
  it('refuses a remote single-user node without API login, like the public seed nodes', () => {
    expect(isSharedLogin({ url: 'http://node3.nexus.io:8080', user: '', password: '' }, { multiuser: false })).toBe(true);
    expect(isSharedLogin({ url: 'http://node3.nexus.io:8080', user: 'apiserver', password: 'x' }, { multiuser: false })).toBe(false);
    expect(isSharedLogin({ url: 'http://node.example:8080', user: '', password: '' }, { multiuser: true })).toBe(false);
    expect(isSharedLogin({ url: 'http://127.0.0.1:8080', user: '', password: '' }, { multiuser: false })).toBe(false);
  });
});
