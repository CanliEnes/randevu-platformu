import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, type ManageData } from '../../api.ts';
import { Empty, Modal, useToast } from '../../components/ui.tsx';
import { duration, money } from '../../format.ts';
import { usePanel } from './PanelLayout.tsx';

type ServiceRow = ManageData['services'][number];

export function Services() {
  const { data } = usePanel();
  const [editing, setEditing] = useState<ServiceRow | 'new' | null>(null);
  const staffName = (id: number) => data.staff.find((s) => s.id === id)?.displayName ?? '?';

  return (
    <div className="stack">
      <div className="spread">
        <p className="muted">Müşterilerin seçebileceği hizmetler. Pasif hizmetler sayfanızda görünmez.</p>
        <button className="btn" onClick={() => setEditing('new')}>+ Yeni hizmet</button>
      </div>
      {data.services.length === 0 ? (
        <Empty title="Henüz hizmet yok">İlk hizmetini ekleyerek randevu almaya başla.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Hizmet</th>
                <th>Süre</th>
                <th className="num">Ücret</th>
                <th>Kimler veriyor</th>
                <th>Durum</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.services.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'is-inactive'}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.description && <div className="muted small">{s.description}</div>}
                  </td>
                  <td>{duration(s.durationMinutes)}</td>
                  <td className="num">{money(s.priceCents)}</td>
                  <td className="small">{s.staffIds.length ? s.staffIds.map(staffName).join(', ') : <span className="muted">Kimse — Çalışanlar sekmesinden atayın</span>}</td>
                  <td><span className={`badge ${s.active ? 'badge--completed' : 'badge--cancelled'}`}>{s.active ? 'Aktif' : 'Pasif'}</span></td>
                  <td className="num"><button className="btn btn--ghost btn--sm" onClick={() => setEditing(s)}>Düzenle</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ServiceDialog service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServiceDialog({ service, onClose }: { service: ServiceRow | null; onClose: () => void }) {
  const { data } = usePanel();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: service?.name ?? '',
    description: service?.description ?? '',
    durationMinutes: service?.durationMinutes ?? 30,
    price: service ? service.priceCents / 100 : 0,
    active: service?.active ?? true,
    staffIds: service?.staffIds ?? data.staff.filter((s) => s.active).map((s) => s.id),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, description: form.description, durationMinutes: form.durationMinutes, priceCents: Math.round(form.price * 100) };
      return service
        ? api(`/services/${service.id}`, { method: 'PATCH', body: { ...body, active: form.active } })
        : api(`/businesses/${data.business.id}/services`, { body: { ...body, staffIds: form.staffIds } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manage', data.business.id] });
      queryClient.invalidateQueries({ queryKey: ['business', data.business.slug] });
      toast(service ? 'Hizmet güncellendi.' : 'Hizmet eklendi.');
      onClose();
    },
  });

  return (
    <Modal title={service ? 'Hizmeti düzenle' : 'Yeni hizmet'} onClose={onClose}>
      <form
        className="stack"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="field">
          <span>Ad</span>
          <input className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Açıklama</span>
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Süre</span>
            <select className="select" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}>
              {[10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240].map((m) => (
                <option key={m} value={m}>{duration(m)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ücret (₺)</span>
            <input className="input" type="number" min={0} step={10} required value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
          </label>
        </div>
        {!service && data.staff.length > 0 && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Bu hizmeti kimler veriyor?</span>
            <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
              {data.staff.map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={form.staffIds.includes(s.id)}
                    onChange={(e) =>
                      setForm({ ...form, staffIds: e.target.checked ? [...form.staffIds, s.id] : form.staffIds.filter((id) => id !== s.id) })
                    }
                  />
                  {s.displayName}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {service && (
          <label className="check" style={{ alignSelf: 'flex-start' }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Aktif (müşteriler görebilir)
          </label>
        )}
        {save.error && <div className="form-error">{errorMessage(save.error)}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn" disabled={save.isPending}>Kaydet</button>
        </div>
      </form>
    </Modal>
  );
}
