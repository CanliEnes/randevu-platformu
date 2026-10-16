import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { api, type Email } from '../api.ts';
import { useMe } from '../auth.tsx';
import { Empty, Skeleton } from '../components/ui.tsx';

const KIND_LABEL: Record<string, string> = {
  confirmation: 'Onay',
  reminder: 'Hatırlatma',
  cancellation: 'İptal',
  'owner-new': 'Yeni randevu',
  'owner-cancelled': 'İptal bildirimi',
};

/** Demo mailbox: shows the e-mails the system "sent" to the signed-in user. */
export function Mailbox() {
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({
    queryKey: ['emails'],
    queryFn: () => api<{ emails: Email[] }>('/me/emails'),
    refetchInterval: 5000, // the confirmation is sent by a background job a moment after booking
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const emails = data?.emails ?? [];
  const selected = emails.find((e) => e.id === selectedId) ?? emails[0];

  return (
    <div className="container page">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 36 }}>Posta kutusu</h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Demo ortamında gerçek e-posta gönderilmez. Sistemin <strong>{me?.user.email}</strong> adresine gönderdiği e-postalar burada görünür.
        </p>
      </div>
      {isLoading && <Skeleton height={420} />}
      {data && emails.length === 0 && (
        <Empty title="Henüz e-posta yok">Bir randevu aldığında onay e-postası birkaç saniye içinde burada belirir.</Empty>
      )}
      {selected && (
        <div className="card mailbox">
          <div className="mail-list">
            {emails.map((e) => (
              <button key={e.id} className="mail-item" aria-pressed={e.id === selected.id} onClick={() => setSelectedId(e.id)}>
                <span className="spread small muted">
                  <span>{KIND_LABEL[e.kind] ?? e.kind}</span>
                  <span>{DateTime.fromISO(e.createdAt).setLocale('tr').toRelative()}</span>
                </span>
                <strong>{e.subject}</strong>
              </button>
            ))}
          </div>
          <article className="mail-body">
            <div className="eyebrow">{KIND_LABEL[selected.kind] ?? selected.kind}</div>
            <h2 style={{ fontSize: 24, marginTop: 6 }}>{selected.subject}</h2>
            <p className="muted small" style={{ marginTop: 6 }}>
              Kimden: Sıradaki &lt;noreply@randevu.test&gt; · {DateTime.fromISO(selected.createdAt).setLocale('tr').toFormat('d MMMM yyyy HH:mm')}
            </p>
            <pre>{selected.body}</pre>
          </article>
        </div>
      )}
    </div>
  );
}
