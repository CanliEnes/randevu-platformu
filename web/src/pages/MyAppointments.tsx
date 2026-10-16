import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, type Appointment } from '../api.ts';
import { Empty, Modal, Skeleton, StarInput, Stars, StatusBadge, useToast } from '../components/ui.tsx';
import { inZone, money, time } from '../format.ts';

export function MyAppointments() {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [reviewing, setReviewing] = useState<Appointment | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['my-appointments'],
    queryFn: () => api<{ appointments: Appointment[] }>('/me/appointments'),
  });

  const all = data?.appointments ?? [];
  const upcoming = all
    .filter((a) => a.displayStatus === 'upcoming' || a.displayStatus === 'in_progress')
    .sort((a, b) => a.start.localeCompare(b.start));
  const past = all.filter((a) => !upcoming.includes(a));
  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="container page" style={{ maxWidth: 860 }}>
      <div className="spread" style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 36 }}>Randevularım</h1>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'upcoming'} onClick={() => setTab('upcoming')}>
            Yaklaşan {upcoming.length > 0 && `(${upcoming.length})`}
          </button>
          <button role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>Geçmiş</button>
        </div>
      </div>

      {isLoading && <div className="stack"><Skeleton height={96} count={3} /></div>}
      {data && list.length === 0 && (
        <Empty title={tab === 'upcoming' ? 'Yaklaşan randevun yok' : 'Geçmiş randevun yok'}>
          <Link to="/" className="btn">İşletmeleri keşfet</Link>
        </Empty>
      )}
      <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
        {list.map((a, i) => {
          const start = inZone(a.start, a.timezone);
          return (
            <article key={a.id} className="card appt" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="appt__date">
                <small>{start.toFormat('ccc')}</small>
                <strong>{start.day}</strong>
                <small>{start.toFormat('LLL')}</small>
              </div>
              <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
                <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <strong style={{ fontSize: 17 }}>{a.serviceName}</strong>
                  <StatusBadge status={a.displayStatus} />
                </div>
                <div className="muted small">
                  {time(a.start, a.timezone)}–{time(a.end, a.timezone)} · {a.staffName} ·{' '}
                  <Link to={`/isletme/${a.businessSlug}`}>{a.businessName}</Link>
                </div>
                <div className="small">{a.priceCents === 0 ? 'Ücretsiz' : money(a.priceCents)}</div>
              </div>
              <div className="appt__actions">
                {a.reviewRating !== null && <Stars value={a.reviewRating} />}
                {a.canReview && <button className="btn btn--sm" onClick={() => setReviewing(a)}>Değerlendir</button>}
                {a.canCancel && <button className="btn btn--danger btn--sm" onClick={() => setCancelling(a)}>İptal et</button>}
                {a.displayStatus === 'upcoming' && !a.canCancel && (
                  <span className="muted small" title="Randevuya 2 saatten az kaldı">İptal süresi geçti</span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {cancelling && <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} />}
      {reviewing && <ReviewDialog appointment={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}

function CancelDialog({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: () => api(`/appointments/${a.id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      toast('Randevu iptal edildi. Saat başkalarına açıldı.');
      onClose();
    },
  });
  return (
    <Modal title="Randevu iptal edilsin mi?" onClose={onClose}>
      <p className="muted" style={{ margin: '8px 0 20px' }}>
        {inZone(a.start, a.timezone).toFormat('d MMMM cccc, HH:mm')} · {a.serviceName} · {a.businessName}
      </p>
      {cancel.error && <div className="form-error" style={{ marginBottom: 14 }}>{errorMessage(cancel.error)}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" onClick={onClose}>Vazgeç</button>
        <button className="btn btn--danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          {cancel.isPending ? 'İptal ediliyor…' : 'Evet, iptal et'}
        </button>
      </div>
    </Modal>
  );
}

function ReviewDialog({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () => api(`/appointments/${a.id}/review`, { body: { rating, comment } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      queryClient.invalidateQueries({ queryKey: ['business', a.businessSlug] });
      toast('Teşekkürler! Değerlendirmen yayınlandı.');
      onClose();
    },
  });
  return (
    <Modal title={`${a.businessName} nasıldı?`} onClose={onClose}>
      <p className="muted small" style={{ marginBottom: 16 }}>{a.serviceName} · {a.staffName}</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <StarInput value={rating} onChange={setRating} />
        <label className="field">
          <span>Yorum (isteğe bağlı)</span>
          <textarea className="textarea" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {send.error && <div className="form-error">{errorMessage(send.error)}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn" disabled={rating === 0 || send.isPending}>Gönder</button>
        </div>
      </form>
    </Modal>
  );
}
