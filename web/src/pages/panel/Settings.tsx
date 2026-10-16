import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../../api.ts';
import { useToast } from '../../components/ui.tsx';
import { usePanel } from './PanelLayout.tsx';

const TIMEZONES = ['Europe/Istanbul', 'Europe/Berlin', 'Europe/London', 'Europe/Amsterdam', 'Asia/Baku', 'Asia/Dubai'];

export function Settings() {
  const { data } = usePanel();
  const queryClient = useQueryClient();
  const toast = useToast();
  const b = data.business;
  const [form, setForm] = useState({ name: b.name, category: b.category, address: b.address, description: b.description, timezone: b.timezone });
  const save = useMutation({
    mutationFn: () => api(`/businesses/${b.id}`, { method: 'PATCH', body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manage', b.id] });
      queryClient.invalidateQueries({ queryKey: ['business', b.slug] });
      queryClient.invalidateQueries({ queryKey: ['businesses'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('İşletme bilgileri kaydedildi.');
    },
  });

  return (
    <form
      className="card card--pad stack"
      style={{ maxWidth: 720 }}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>İşletme adı</span>
          <input className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Kategori</span>
          <input className="input" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Adres</span>
        <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </label>
      <label className="field">
        <span>Tanıtım</span>
        <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label className="field" style={{ maxWidth: 320 }}>
        <span>Saat dilimi</span>
        <select className="select" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
          {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
        </select>
        <small className="muted">Çalışma saatleri bu saat dilimine göre yorumlanır.</small>
      </label>
      <p className="muted small">Sayfa adresi: <code>/isletme/{b.slug}</code> (değiştirilemez)</p>
      {save.error && <div className="form-error">{errorMessage(save.error)}</div>}
      <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={save.isPending}>Kaydet</button>
    </form>
  );
}
