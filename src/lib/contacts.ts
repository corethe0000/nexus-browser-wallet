import { isRecipient } from './format';

//address book, only in this browser (storage.local), never sent to the node or to sites
const key = 'contacts';
const maxContacts = 500;
export const maxContactName = 60;
export const maxContactNote = 200;

export interface Contact {
  id: string;
  name: string;
  //account address or name (name, user:name, namespace::name)
  to: string;
  note?: string;
}

export async function listContacts(): Promise<Contact[]> {
  const got = await browser.storage.local.get(key);
  const list = (got[key] as Contact[] | undefined) ?? [];
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveContact(c: Omit<Contact, 'id'> & { id?: string }): Promise<Contact> {
  const list = await listContacts();
  const contact: Contact = { id: c.id ?? crypto.randomUUID(), name: c.name.trim(), to: c.to.trim(), note: c.note?.trim() || undefined };
  const rest = list.filter((x) => x.id !== contact.id);
  await browser.storage.local.set({ [key]: [...rest, contact] });
  return contact;
}

export async function removeContact(id: string): Promise<void> {
  const list = await listContacts();
  await browser.storage.local.set({ [key]: list.filter((x) => x.id !== id) });
}

//contacts from a backup file: only well formed ones, an address already in the book keeps its contact
export async function importContacts(raw: unknown): Promise<number> {
  if (!Array.isArray(raw)) {
    return 0;
  }
  const list = await listContacts();
  const known = new Set(list.map((c) => c.to));
  const added: Contact[] = [];
  for (const r of raw) {
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    const to = typeof r?.to === 'string' ? r.to.trim() : '';
    const note = typeof r?.note === 'string' ? r.note.trim().slice(0, maxContactNote) : '';
    if (!name || name.length > maxContactName || !isRecipient(to) || known.has(to) || list.length + added.length >= maxContacts) {
      continue;
    }
    known.add(to);
    added.push({ id: crypto.randomUUID(), name, to, note: note || undefined });
  }
  if (added.length) {
    await browser.storage.local.set({ [key]: [...list, ...added] });
  }
  return added.length;
}

export function findContact(list: Contact[], to: string | undefined): Contact | undefined {
  return to ? list.find((c) => c.to === to) : undefined;
}
