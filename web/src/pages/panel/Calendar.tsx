import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, type Appointment } from '../../api.ts';
import { Modal, StatusBadge, useToast } from '../../components/ui.tsx';
import { money } from '../../format.ts';
import { usePanel } from './PanelLayout.tsx';

const HOUR_PX = 52;
const STAFF_COLORS = ['#1f4d3f', '#c0612b', '#2e4a7d', '#7a3e6b', '#8a6d14', '#2f6b6b'];

export function Calendar() {
  const { data, isOwner, fresh } = usePanel();
  const zone = data.business.timezone;
  const [weekStart, setWeekStart] = useState(() => DateTime.now().setZone(zone).startOf('week'));
  // One person's week is readable; everyone at once is an opt-in overview.
  const [staffFilter, setStaffFilter] = useState<number | 'all'>(() => data.ownStaffId ?? data.staff.find((s) => s.active)?.id ?? 'all');
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [now, setNow] = useState(() => DateTime.now().setZone(zone));
  useEffect(() => {
    const timer = setInterval(() => setNow(DateTime.now().setZone(zone)), 60_000);
    return () => clearInterval(timer);
  }, [zone]);

  const from = weekStart.toISO()!;
  const to = weekStart.plus({ weeks: 1 }).toISO()!;
  const { data: result, isFetching } = useQuery({
    queryKey: ['panel-appointments', data.business.id, from],
    queryFn: () =>
      api<{ appointments: Appointment[] }>(
        `/businesses/${data.business.id}/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    placeholderData: (previous) => previous,
  });

  // Visible hours: from the earliest opening to the latest closing of anyone.
  const [firstHour, lastHour] = useMemo(() => {
    const hours = data.staff.flatMap((s) => s.workingHours);
    if (hours.length === 0) return [8, 20];
    const min = Math.min(...hours.map((h) => Number(h.start.slice(0, 2))));
    const max = Math.max(...hours.map((h) => Math.ceil(Number(h.end.slice(0, 2)) + Number(h.end.slice(3)) / 60)));
    return [Math.max(0, min - 1), Math.min(24, max + 1)];
  }, [data.staff]);

  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }));
  const appointments = (result?.appointments ?? []).filter((a) => staffFilter === 'all' || a.staffId === staffFilter);
  const active = appointments.filter((a) => a.status !== 'cancelled');
  const weekRevenue = active.reduce((sum, a) => sum + a.priceCents, 0);

  return (
    <div>
      <div className="cal-toolbar">
        <div className="row">
          <div className="row" style={{ '--gap': '6px' } as React.CSSProperties}>
            <button className="btn btn--ghost btn--sm" onClick={() => setWeekStart(weekStart.minus({ weeks: 1 }))} aria-label="Önceki hafta">←</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setWeekStart(DateTime.now().setZone(zone).startOf('week'))}>Bu hafta</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setWeekStart(weekStart.plus({ weeks: 1 }))} aria-label="Sonraki hafta">→</button>
          </div>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 19 }}>
            {weekStart.setLocale('tr').toFormat('d MMM')} – {weekStart.plus({ days: 6 }).setLocale('tr').toFormat('d MMM yyyy')}
          </strong>
          {isFetching && <span className="muted small">Yükleniyor…</span>}
        </div>
        <div className="row">
          <span className="muted small">{active.length} randevu · {money(weekRevenue)}</span>
          {isOwner && data.staff.length > 1 && (
            <select className="select" style={{ minHeight: 34, width: 'auto' }} value={staffFilter} onChange={(e) => setStaffFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Çalışan filtresi">
              <option value="all">Tüm çalışanlar</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {staffFilter === 'all' && (
        <div className="row small" style={{ marginBottom: 10, '--gap': '14px' } as React.CSSProperties}>
          {data.staff.map((s, i) => (
            <span key={s.id} className="row" style={{ '--gap': '6px' } as React.CSSProperties}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: STAFF_COLORS[i % STAFF_COLORS.length] }} aria-hidden />
              {s.displayName}
            </span>
          ))}
        </div>
      )}
      <div className="card cal-scroll">
        <div
          className="cal"
          style={{
            '--hour': `${HOUR_PX}px`,
            // In the overview every staff member gets a fixed sub-column; give each at least 64px.
            minWidth: staffFilter === 'all' ? 54 + 7 * Math.max(118, data.staff.length * 64) : undefined,
          } as React.CSSProperties}
        >
          <div className="cal__corner" />
          {days.map((d) => (
            <div key={d.toISODate()} className={`cal__day ${d.hasSame(now, 'day') ? 'is-today' : ''}`}>
              <small>{d.setLocale('tr').toFormat('ccc')}</small>
              <strong>{d.day}</strong>
            </div>
          ))}

          <div className="cal__hours">
            {Array.from({ length: lastHour - firstHour }, (_, i) => (
              <div key={i} className="cal__hour">{String(firstHour + i).padStart(2, '0')}:00</div>
            ))}
          </div>
          {days.map((day) => (
            <DayColumn
              key={day.toISODate()}
              day={day}
              zone={zone}
              now={now}
              firstHour={firstHour}
              lastHour={lastHour}
              appointments={appointments.filter((a) => DateTime.fromISO(a.start, { zone }).hasSame(day, 'day'))}
              fresh={fresh}
              onSelect={setSelected}
              staffLanes={staffFilter === 'all' ? data.staff.map((s) => s.id) : null}
            />
          ))}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Yeşil: yaklaşan · Gri: tamamlandı · Kırmızı: gelmedi · Taralı: iptal. Ayrıntı için randevuya tıklayın.
      </p>

      {selected && <AppointmentDialog appointment={selected} zone={zone} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DayColumn(props: {
  day: DateTime;
  zone: string;
  now: DateTime;
  firstHour: number;
  lastHour: number;
  appointments: Appointment[];
  fresh: Set<number>;
  onSelect: (a: Appointment) => void;
  /** Overview mode: one fixed lane per staff member, in this order. */
  staffLanes: number[] | null;
}) {
  const { day, zone, now, firstHour, lastHour, appointments, fresh, onSelect, staffLanes } = props;
  const minutesFromTop = (dt: DateTime) => (dt.hour - firstHour) * 60 + dt.minute;

  // Appointments that overlap in time are placed side by side in "lanes".
  // Overview: lane = staff member. Single person: lanes only for a cancelled + rebooked overlap.
  const sorted = [...appointments].sort((a, b) => a.start.localeCompare(b.start));
  const lanes = new Map<number, number>();
  let laneCount = 1;
  if (staffLanes) {
    for (const a of sorted) lanes.set(a.id, Math.max(0, staffLanes.indexOf(a.staffId)));
    laneCount = Math.max(1, staffLanes.length);
  } else {
    const laneEnds: string[] = [];
    for (const a of sorted) {
      let lane = laneEnds.findIndex((end) => end <= a.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = a.end;
      lanes.set(a.id, lane);
    }
    laneCount = Math.max(1, laneEnds.length);
  }

  const showNow = day.hasSame(now, 'day') && now.hour >= firstHour && now.hour < lastHour;

  return (
    <div className="cal__col" style={{ height: (lastHour - firstHour) * HOUR_PX }}>
      {showNow && <div className="cal__now" style={{ top: (minutesFromTop(now) / 60) * HOUR_PX }} aria-hidden />}
      {sorted.map((a) => {
        const start = DateTime.fromISO(a.start, { zone });
        const end = DateTime.fromISO(a.end, { zone });
        const top = (minutesFromTop(start) / 60) * HOUR_PX;
        const height = Math.max(22, (end.diff(start, 'minutes').minutes / 60) * HOUR_PX - 2);
        const lane = lanes.get(a.id)!;
        const width = 100 / laneCount;
        return (
          <button
            key={a.id}
            className={`cal__event cal__event--${a.displayStatus} ${fresh.has(a.id) ? 'cal__event--fresh' : ''}`}
            style={{
              top, height, left: `calc(${lane * width}% + 3px)`, width: `calc(${width}% - 6px)`, right: 'auto',
              ...(staffLanes && a.status === 'booked' && a.displayStatus !== 'completed' ? { borderLeftColor: STAFF_COLORS[lane % STAFF_COLORS.length] } : {}),
            }}
            onClick={() => onSelect(a)}
            title={`${start.toFormat('HH:mm')} ${a.customerName} · ${a.serviceName} · ${a.staffName}`}
          >
            <strong>{start.toFormat('HH:mm')}{staffLanes ? '' : ` ${a.customerName}`}</strong>
            {height > 36 && <span>{staffLanes ? a.customerName : `${a.serviceName}`}</span>}
          </button>
        );
      })}
    </div>
  );
}

function AppointmentDialog({ appointment: a, zone, onClose }: { appointment: Appointment; zone: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const action = useMutation({
    mutationFn: (kind: 'cancel' | 'no-show') => api(`/appointments/${a.id}/${kind}`, { method: 'POST' }),
    onSuccess: (_, kind) => {
      queryClient.invalidateQueries({ queryKey: ['panel-appointments', a.businessId] });
      toast(kind === 'cancel' ? 'Randevu iptal edildi, müşteriye e-posta gönderildi.' : '"Gelmedi" olarak işaretlendi.');
      onClose();
    },
  });
  const start = DateTime.fromISO(a.start, { zone }).setLocale('tr');
  const started = start <= DateTime.now();
  return (
    <Modal title={a.customerName} onClose={onClose}>
      <div className="row" style={{ margin: '6px 0 16px' }}>
        <StatusBadge status={a.displayStatus} />
      </div>
      <div className="summary" style={{ position: 'static', padding: 0 }}>
        <dl style={{ margin: 0 }}>
          <dt>Zaman</dt>
          <dd>{start.toFormat('d MMMM cccc, HH:mm')}</dd>
          <dt>Hizmet</dt>
          <dd>{a.serviceName}</dd>
          <dt>Çalışan</dt>
          <dd>{a.staffName}</dd>
          <dt>Ücret</dt>
          <dd>{money(a.priceCents)}</dd>
          <dt>E-posta</dt>
          <dd><a href={`mailto:${a.customerEmail}`}>{a.customerEmail}</a></dd>
          {a.note && (
            <>
              <dt>Not</dt>
              <dd>{a.note}</dd>
            </>
          )}
        </dl>
      </div>
      {action.error && <div className="form-error" style={{ marginTop: 14 }}>{errorMessage(action.error)}</div>}
      {a.status === 'booked' && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          {started ? (
            <button className="btn btn--danger" disabled={action.isPending} onClick={() => action.mutate('no-show')}>Gelmedi olarak işaretle</button>
          ) : (
            <button className="btn btn--danger" disabled={action.isPending} onClick={() => action.mutate('cancel')}>Randevuyu iptal et</button>
          )}
        </div>
      )}
    </Modal>
  );
}
