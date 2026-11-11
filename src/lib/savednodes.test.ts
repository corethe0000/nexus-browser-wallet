import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { forgetNode, loadNode, loadSavedNodes, removeSavedNode, saveNode } from './settings';

describe('saved cores', () => {
  beforeEach(() => fakeBrowser.reset());

  it('keeps every core used, newest first, one entry per address and user', async () => {
    await saveNode({ url: 'http://127.0.0.1:8080', user: 'api', password: 'a' });
    await saveNode({ url: 'http://127.0.0.1:7081', user: '', password: '' });
    await saveNode({ url: 'http://127.0.0.1:8080', user: 'api', password: 'b' });
    const list = await loadSavedNodes();
    expect(list.map((n) => n.url)).toEqual(['http://127.0.0.1:8080', 'http://127.0.0.1:7081']);
    expect(list[0]!.password).toBe('b');
    expect((await loadNode())?.url).toBe('http://127.0.0.1:8080');
  });

  it('removes one and forgets all on reset', async () => {
    await saveNode({ url: 'http://127.0.0.1:8080', user: 'api', password: 'a' });
    await saveNode({ url: 'http://127.0.0.1:7081', user: '', password: '' });
    await removeSavedNode('http://127.0.0.1:8080', 'api');
    expect((await loadSavedNodes()).length).toBe(1);
    await forgetNode();
    expect(await loadSavedNodes()).toEqual([]);
    expect(await loadNode()).toBeNull();
  });
});
