import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Stats } from '../../api.ts';
import { Skeleton } from '../../components/ui.tsx';
import { money, WEEKDAYS_SHORT } from '../../format.ts';
import { usePanel } from './PanelLayout.tsx';

const INK = '#1d1b16';
const BRAND = '#1f4d3f';
const ACCENT = '#f08a4b';
const GRID = '#e0d7c5';
const axis = { fontSize: 12, fill: '#6b6559' };

export function StatsPage() {
  const { data } = usePanel();
  const [days, setDays] = useState(30);
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', data.business.id, days],
    queryFn: () => api<Stats>(`/businesses/${data.business.id}/stats?days=${days}`),
    placeholderData: (previous) => previous,
  });

  return (
    <div>
      <div className="spread" style={{ marginBottom: 18 }}>
        <p className="muted">Son {days} günde başlayan randevular. Gelir yalnızca tamamlanan randevulardan hesaplanır.</p>
        <div className="tabs" role="tablist" aria-label="Dönem">
          {[7, 30, 90].map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)}>{d} gün</button>
          ))}
        </div>
      </div>

      {isLoading || !stats ? (
        <div className="stack"><Skeleton height={110} /><Skeleton height={320} /></div>
      ) : (
        <StatsView stats={stats} />
      )}
    </div>
  );
}

function StatsView({ stats }: { stats: Stats }) {
  const s = stats.summary;
  const daily = stats.daily.map((d) => ({
    ...d,
    label: DateTime.fromISO(d.date).setLocale('tr').toFormat('d MMM'),
    revenue: d.revenueCents / 100,
  }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour: `${String(hour).padStart(2, '0')}`, count: stats.byHour.find((h) => h.hour === hour)?.count ?? 0 }))
    .filter((h, i, all) => h.count > 0 || (i > 0 && all[i - 1]!.count > 0 && all.slice(i).some((x) => x.count > 0)));
  const weekdays = WEEKDAYS_SHORT.map((name, i) => ({ name, count: stats.byWeekday.find((w) => w.weekday === i + 1)?.count ?? 0 }));

  const cards = [
    { label: 'Gelir', value: money(s.revenueCents), hint: `${s.completed} tamamlanan randevu` },
    { label: 'Randevu', value: s.total.toLocaleString('tr-TR'), hint: `${s.upcoming} yaklaşan randevu` },
    { label: 'İptal oranı', value: `%${s.cancellationRate.toLocaleString('tr-TR')}`, hint: `${s.cancelled} iptal · ${s.noShow} gelmedi` },
    { label: 'Ortalama puan', value: s.averageRating ? s.averageRating.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—', hint: `${s.reviewCount} değerlendirme (tüm zamanlar)` },
  ];

  return (
    <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <div className="stat-cards" style={{ marginBottom: 0 }}>
        {cards.map((c) => (
          <div key={c.label} className="card stat">
            <div className="eyebrow">{c.label}</div>
            <div className="stat__value">{c.value}</div>
            <div className="stat__hint">{c.hint}</div>
          </div>
        ))}
      </div>

      <div className="charts">
        <section className="card card--pad card--wide">
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Günlük randevu ve gelir</h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={daily} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={18} />
                <YAxis yAxisId="count" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="revenue" orientation="right" tick={axis} tickLine={false} axisLine={false} tickFormatter={(v: number) => `₺${(v / 1000).toLocaleString('tr-TR')}b`} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: `1px solid ${GRID}` }}
                  formatter={(value, name) => (name === 'revenue' ? [money(Number(value) * 100), 'Gelir'] : [value, 'Randevu'])}
                />
                <Bar yAxisId="count" dataKey="count" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Line yAxisId="revenue" dataKey="revenue" stroke={ACCENT} strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card card--pad">
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>En yoğun saatler</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={hours} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="hour" tick={axis} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 10 }} formatter={(v) => [v, 'Randevu']} labelFormatter={(l) => `${l}:00 – ${l}:59`} />
                <Bar dataKey="count" fill={ACCENT} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card card--pad">
          <h3 style={{ fontSize: 18, marginBottom: 12 }}>Haftanın günleri</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={weekdays} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 10 }} formatter={(v) => [v, 'Randevu']} />
                <Bar dataKey="count" fill={INK} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card">
          <h3 style={{ fontSize: 18, padding: '20px 20px 4px' }}>Hizmetler</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Hizmet</th><th className="num">Randevu</th><th className="num">Gelir</th></tr></thead>
              <tbody>
                {stats.topServices.map((t) => (
                  <tr key={t.name}><td>{t.name}</td><td className="num">{t.count}</td><td className="num">{money(t.revenueCents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h3 style={{ fontSize: 18, padding: '20px 20px 4px' }}>Çalışanlar</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Çalışan</th><th className="num">Randevu</th><th className="num">Gelmedi</th><th className="num">Gelir</th></tr></thead>
              <tbody>
                {stats.staff.map((t) => (
                  <tr key={t.name}><td>{t.name}</td><td className="num">{t.count}</td><td className="num">{t.noShow}</td><td className="num">{money(t.revenueCents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
