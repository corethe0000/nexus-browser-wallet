import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { importContacts, listContacts, saveContact } from './contacts';
import { isExplorerUrl } from './settings';

describe('contacts from a backup', () => {
  beforeEach(() => fakeBrowser.reset());

  it('adds only well formed contacts, an address already known keeps its own', async () => {
    await saveContact({ name: 'Bob', to: 'bob:main' });
    const n = await importContacts([
      { name: 'Bob again', to: 'bob:main' },
      { name: 'Carol', to: 'carol:savings', note: 'rent' },
      { name: '', to: 'dave:main' },
      { name: 'Bad', to: 'has space' },
      { name: 'x'.repeat(61), to: 'erin:main' },
      'junk',
    ]);
    expect(n).toBe(1);
    const list = await listContacts();
    expect(list.map((c) => c.name)).toEqual(['Bob', 'Carol']);
    expect(list[1]!.note).toBe('rent');
    expect(await importContacts({ not: 'a list' })).toBe(0);
  });

  it('takes only web addresses as explorer', () => {
    expect(isExplorerUrl('https://explorer.nexus.io')).toBe(true);
    expect(isExplorerUrl('javascript:alert(1)')).toBe(false);
    expect(isExplorerUrl(42)).toBe(false);
  });
});
