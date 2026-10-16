import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, errorMessage, type Appointment, type Availability, type BusinessPage as Page } from '../api.ts';
import { useMe } from '../auth.tsx';
import { Empty, Skeleton, Stars, useToast } from '../components/ui.tsx';
import { businessColor, duration, initials, longDate, money, time } from '../format.ts';

const ANY = 'any' as const;

export function BusinessPage() {
  const { slug } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['business', slug],
    queryFn: () => api<Page>(`/businesses/by-slug/${slug}`),
  });

  if (isLoading) {
    return (
      <div className="container page stack">
        <Skeleton height={110} />
        <Skeleton height={420} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="container page">
        <Empty title="İşletme bulunamadı">
          <Link to="/" className="btn">Tüm işletmeler</Link>
        </Empty>
      </div>
    );
  }
  return <BusinessView page={data} />;
}

function BusinessView({ page }: { page: Page }) {
  const { business, services, staff, rating, reviews } = page;
  const zone = business.timezone;

  return (
    <div className="container" style={{ paddingBottom: 72 }}>
      <header className="biz-head">
        <div className="biz-head__art" style={{ background: businessColor(business.slug) }} aria-hidden>
          {initials(business.name)}
        </div>
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
            <span className="chip">{business.category}</span>
            {rating.average !== null && (
              <span className="rating small">
                <span className="rating__star" aria-hidden>★</span> {rating.average.toFixed(1)}
                <span className="muted" style={{ fontWeight: 400 }}>· {rating.count} değerlendirme</span>
              </span>
            )}
          </div>
          <h1>{business.name}</h1>
          <p className="muted">{business.address}</p>
        </div>
      </header>
      {business.description && <p style={{ maxWidth: 680, marginBottom: 28, fontSize: 17 }}>{business.description}</p>}

      <BookingFlow page={page} />

      <section style={{ marginTop: 48 }}>
        <h2 className="section-title">Değerlendirmeler</h2>
        {reviews.length === 0 ? (
          <Empty title="Henüz değerlendirme yok">İlk randevuyu alan sen ol.</Empty>
        ) : (
          <div className="card card--pad" style={{ paddingBlock: 6 }}>
            {reviews.map((r) => (
              <article key={r.id} className="review">
                <div className="spread">
                  <div className="row" style={{ '--gap': '10px' } as React.CSSProperties}>
                    <Stars value={r.rating} />
                    <strong>{r.author}</strong>
                    <span className="muted small">{r.serviceName}</span>
                  </div>
                  <span className="muted small">{DateTime.fromISO(r.createdAt, { zone }).setLocale('tr').toRelative()}</span>
                </div>
                {r.comment && <p style={{ marginTop: 6 }}>{r.comment}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
      {staff.length === 0 && services.length === 0 && <Empty title="Bu işletme henüz hizmet eklemedi" />}
    </div>
  );
}

function BookingFlow({ page }: { page: Page }) {
  const { business, services, staff } = page;
  const zone = business.timezone;
  const { data: me } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [serviceId, setServiceId] = useState<number | null>(services[0]?.id ?? null);
  const [staffChoice, setStaffChoice] = useState<number | typeof ANY>(ANY);
  const days = useMemo(() => {
    const today = DateTime.now().setZone(zone).startOf('day').setLocale('tr');
    return Array.from({ length: 21 }, (_, i) => today.plus({ days: i }));
  }, [zone]);
  const [date, setDate] = useState(days[0]!.toISODate()!);
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<Appointment | null>(null);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const staffForService = staff.filter((s) => service?.staffIds.includes(s.id));
  useEffect(() => {
    setSlot(null);
  }, [serviceId, staffChoice, date]);
  useEffect(() => {
    if (staffChoice !== ANY && !staffForService.some((s) => s.id === staffChoice)) setStaffChoice(ANY);
  }, [serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const availabilityKey = ['availability', business.id, serviceId, staffChoice, date];
  const availability = useQuery({
    queryKey: availabilityKey,
    enabled: serviceId !== null,
    queryFn: () =>
      api<Availability>(
        `/businesses/${business.id}/availability?serviceId=${serviceId}&date=${date}${staffChoice === ANY ? '' : `&staffId=${staffChoice}`}`,
      ),
  });

  const book = useMutation({
    mutationFn: () =>
      api<{ appointment: Appointment }>('/appointments', {
        body: { serviceId, start: slot, ...(staffChoice === ANY ? {} : { staffId: staffChoice }) },
      }),
    onSuccess: ({ appointment }) => {
      setBooked(appointment);
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      queryClient.invalidateQueries({ queryKey: ['availability', business.id] });
    },
    onError: (error) => {
      toast(errorMessage(error), 'error');
      if (error instanceof ApiError && error.status === 409) {
        setSlot(null);
        availability.refetch();
      }
    },
  });

  if (booked) return <BookedCard appointment={booked} onAgain={() => { setBooked(null); setSlot(null); }} />;

  const groups = groupSlots(availability.data?.slots ?? [], zone);
  const chosenStaff = staffChoice === ANY ? null : staff.find((s) => s.id === staffChoice);

  return (
    <div className="booking">
      <div className="card">
        <section className="step">
          <h2 className="step__title"><span className="step__num">1</span>Hizmet</h2>
          <div className="options">
            {services.map((s) => (
              <button key={s.id} className="option" aria-pressed={s.id === serviceId} onClick={() => setServiceId(s.id)}>
                <span>
                  <span className="option__title">{s.name}</span>
                  <span className="option__meta"> · {duration(s.durationMinutes)}</span>
                  {s.description && <span className="option__meta" style={{ display: 'block' }}>{s.description}</span>}
                </span>
                <span className="option__price">{s.priceCents === 0 ? 'Ücretsiz' : money(s.priceCents)}</span>
              </button>
            ))}
          </div>
        </section>

        {service && (
          <section className="step">
            <h2 className="step__title"><span className="step__num">2</span>Kiminle?</h2>
            <div className="staff-options">
              <button className="option" aria-pressed={staffChoice === ANY} onClick={() => setStaffChoice(ANY)}>
                <span className="option__title">Fark etmez</span>
                <span className="option__meta">İlk müsait kişi</span>
              </button>
              {staffForService.map((s) => (
                <button key={s.id} className="option" aria-pressed={staffChoice === s.id} onClick={() => setStaffChoice(s.id)}>
                  <span className="option__title">{s.displayName}</span>
                  <span className="option__meta">{s.title || 'Uzman'}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {service && (
          <section className="step">
            <h2 className="step__title"><span className="step__num">3</span>Gün ve saat</h2>
            <div className="date-strip" role="listbox" aria-label="Gün seçin">
              {days.map((d) => (
                <button key={d.toISODate()} className="date-btn" aria-pressed={d.toISODate() === date} onClick={() => setDate(d.toISODate()!)}>
                  <small>{d.toFormat('ccc')}</small>
                  <strong>{d.day}</strong>
                  <small>{d.toFormat('LLL')}</small>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 18 }}>
              {availability.isLoading && <div className="slots"><Skeleton height={42} count={8} /></div>}
              {availability.isError && <p className="form-error">Saatler yüklenemedi.</p>}
              {availability.data && availability.data.slots.length === 0 && (
                <Empty title="Bu gün boş saat yok">Başka bir gün ya da çalışan seçmeyi deneyin.</Empty>
              )}
              {groups.map(([label, list]) => (
                <div key={label} className="slot-group">
                  <h4>{label}</h4>
                  <div className="slots">
                    {list.map((s) => (
                      <button key={s.start} className="slot" aria-pressed={slot === s.start} onClick={() => setSlot(s.start)}>
                        {time(s.start, zone)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="card summary" aria-label="Randevu özeti">
        <div className="eyebrow">Randevu özeti</div>
        <dl>
          <dt>Hizmet</dt>
          <dd>{service?.name ?? '—'}</dd>
          <dt>Süre</dt>
          <dd>{service ? duration(service.durationMinutes) : '—'}</dd>
          <dt>Çalışan</dt>
          <dd>{chosenStaff?.displayName ?? 'Fark etmez'}</dd>
          <dt>Gün</dt>
          <dd>{DateTime.fromISO(date, { zone }).setLocale('tr').toFormat('d MMMM cccc')}</dd>
          <dt>Saat</dt>
          <dd>{slot ? time(slot, zone) : <span className="muted">Seçilmedi</span>}</dd>
        </dl>
        <div className="summary__total">
          <span>Toplam</span>
          <span>{service ? (service.priceCents === 0 ? 'Ücretsiz' : money(service.priceCents)) : '—'}</span>
        </div>
        {me === null ? (
          <button className="btn btn--block" disabled={!slot} onClick={() => navigate(`/giris?next=${encodeURIComponent(location.pathname)}`)}>
            Randevu için giriş yap
          </button>
        ) : (
          <button className="btn btn--accent btn--block" disabled={!slot || book.isPending} onClick={() => book.mutate()}>
            {book.isPending ? 'Onaylanıyor…' : 'Randevuyu onayla'}
          </button>
        )}
        <p className="muted small" style={{ marginTop: 12, textAlign: 'center' }}>
          Ödeme işletmede yapılır. Randevuya 2 saat kalana kadar ücretsiz iptal.
        </p>
      </aside>
    </div>
  );
}

function groupSlots(slots: { start: string; staffIds: number[] }[], zone: string) {
  const groups: [string, typeof slots][] = [['Sabah', []], ['Öğleden sonra', []], ['Akşam', []]];
  for (const s of slots) {
    const hour = DateTime.fromISO(s.start, { zone }).hour;
    groups[hour < 12 ? 0 : hour < 17 ? 1 : 2]![1].push(s);
  }
  return groups.filter(([, list]) => list.length > 0);
}

function BookedCard({ appointment: a, onAgain }: { appointment: Appointment; onAgain: () => void }) {
  return (
    <div className="card success">
      <div className="success__icon" aria-hidden>✓</div>
      <h2 style={{ fontSize: 28 }}>Randevun hazır!</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        {longDate(a.start, a.timezone)}, saat <strong style={{ color: 'var(--ink)' }}>{time(a.start, a.timezone)}</strong> ·{' '}
        {a.serviceName} · {a.staffName}
      </p>
      <p className="muted small" style={{ marginTop: 6 }}>Onay e-postası gönderildi. Randevudan 24 saat önce hatırlatacağız.</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}>
        <Link to="/randevularim" className="btn">Randevularım</Link>
        <Link to="/posta" className="btn btn--ghost">Gelen e-postayı gör</Link>
        <button className="btn btn--ghost" onClick={onAgain}>Yeni randevu</button>
      </div>
    </div>
  );
}
