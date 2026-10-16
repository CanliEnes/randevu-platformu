import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { Empty, useToast } from '../../components/ui.tsx';
import { usePanel } from './PanelLayout.tsx';

export function TimeOff() {
  const { data, isOwner } = usePanel();
  const zone = data.business.timezone;
  const queryClient = useQueryClient();
  const toast = useToast();
  const selectable = isOwner ? data.staff : data.staff.filter((s) => s.id === data.ownStaffId);
  const tomorrow = DateTime.now().setZone(zone).plus({ days: 1 }).toISODate();
  const [form, setForm] = useState({
    staffId: selectable[0]?.id ?? 0,
    start: `${tomorrow}T09:00`,
    end: `${tomorrow}T18:00`,
    reason: '',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['manage', data.business.id] });
    queryClient.invalidateQueries({ queryKey: ['availability', data.business.id] });
  };
  const add = useMutation({
    mutationFn: () =>
      api(`/staff/${form.staffId}/time-off`, {
        body: {
          // The inputs are wall-clock times at the business; convert them to absolute instants.
          start: DateTime.fromISO(form.start, { zone }).toISO(),
          end: DateTime.fromISO(form.end, { zone }).toISO(),
          reason: form.reason,
        },
      }),
    onSuccess: () => {
      refresh();
      toast('İzin eklendi. Bu aralıkta randevu alınamaz.');
      setForm({ ...form, reason: '' });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/time-off/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast('İzin silindi.');
    },
  });

  const name = (id: number) => data.staff.find((s) => s.id === id)?.displayName ?? '?';
  const fmt = (iso: string) => DateTime.fromISO(iso, { zone }).setLocale('tr').toFormat('d MMM yyyy HH:mm');

  return (
    <div className="stack" style={{ '--gap': '22px' } as React.CSSProperties}>
      <form
        className="card card--pad stack"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <h2 style={{ fontSize: 20 }}>İzin / kapalı zaman ekle</h2>
        <div className="form-grid">
          <label className="field">
            <span>Çalışan</span>
            <select className="select" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: Number(e.target.value) })}>
              {selectable.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Başlangıç</span>
            <input className="input" type="datetime-local" step={900} required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </label>
          <label className="field">
            <span>Bitiş</span>
            <input className="input" type="datetime-local" step={900} required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </label>
          <label className="field">
            <span>Sebep</span>
            <input className="input" placeholder="Yıllık izin, eğitim…" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
        </div>
        {add.error && <div className="form-error">{errorMessage(add.error)}</div>}
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={add.isPending || !form.staffId}>İzin ekle</button>
        <p className="muted small">Not: İzin, o aralıktaki mevcut randevuları iptal etmez; yalnızca yeni randevu alınmasını engeller.</p>
      </form>

      <section>
        <h2 className="section-title">Yaklaşan izinler</h2>
        {data.timeOff.length === 0 ? (
          <Empty title="Planlanmış izin yok" />
        ) : (
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr><th>Çalışan</th><th>Başlangıç</th><th>Bitiş</th><th>Sebep</th><th /></tr>
              </thead>
              <tbody>
                {data.timeOff.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{name(t.staffId)}</strong></td>
                    <td>{fmt(t.start)}</td>
                    <td>{fmt(t.end)}</td>
                    <td className="muted">{t.reason || '—'}</td>
                    <td className="num">
                      <button className="btn btn--danger btn--sm" disabled={remove.isPending} onClick={() => remove.mutate(t.id)}>Sil</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
