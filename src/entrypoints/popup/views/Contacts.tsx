import { useEffect, useState } from 'react';
import { isRecipient } from '../../../lib/format';
import { listContacts, maxContactName, maxContactNote, removeContact, saveContact, type Contact } from '../../../lib/contacts';
import { useApp } from '../context';
import { Field, Header } from '../components';

export function Contacts() {
  const { t, go } = useApp();
  const [list, setList] = useState<Contact[]>([]);
  const [edit, setEdit] = useState<Partial<Contact> | null>(null);
  const [touched, setTouched] = useState(false);

  const load = () => listContacts().then(setList);
  useEffect(() => {
    load();
  }, []);

  const nameError = edit && !edit.name?.trim() ? t.contactNameMissing : null;
  const toError = edit && !isRecipient(edit.to ?? '') ? t.badRecipient : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!edit || nameError || toError) {
      return;
    }
    await saveContact({ id: edit.id, name: edit.name!, to: edit.to!, note: edit.note });
    setEdit(null);
    setTouched(false);
    await load();
  }

  return (
    <>
      <Header title={t.contacts} onBack={() => go({ name: 'settings' })} />
      <div className="page">
        {edit ? (
          <form className="card" onSubmit={save}>
            <Field label={t.contactName} error={touched ? nameError : null}>
              <input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={maxContactName} autoFocus />
            </Field>
            <Field label={t.to} hint={t.toHint} error={touched ? toError : null}>
              <input value={edit.to ?? ''} onChange={(e) => setEdit({ ...edit, to: e.target.value })} spellCheck={false} />
            </Field>
            <Field label={t.contactNote}>
              <input value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} maxLength={maxContactNote} />
            </Field>
            <div className="row">
              {edit.id && (
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await removeContact(edit.id!);
                    setEdit(null);
                    await load();
                  }}
                >
                  {t.remove}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setEdit(null)}>
                {t.cancel}
              </button>
              <button className="btn primary">{t.save}</button>
            </div>
          </form>
        ) : (
          <button className="btn primary block" onClick={() => setEdit({})}>
            {t.addContact}
          </button>
        )}
        {list.length === 0 && !edit && <p className="empty">{t.noContacts}</p>}
        {list.length > 0 && (
          <ul className="list">
            {list.map((c) => (
              <li key={c.id} className="clickable" onClick={() => setEdit(c)}>
                <div className="grow">
                  <div className="name">{c.name}</div>
                  <div className="small muted mono">{c.to.length > 30 ? `${c.to.slice(0, 10)}...${c.to.slice(-8)}` : c.to}</div>
                  {c.note && <div className="small muted">{c.note}</div>}
                </div>
                <button
                  className="btn tiny"
                  onClick={(e) => {
                    e.stopPropagation();
                    go({ name: 'send', to: c.to });
                  }}
                >
                  {t.send}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
