import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage, type ManageData } from '../../api.ts';
import { Empty, Modal, useToast } from '../../components/ui.tsx';
import { WEEKDAYS, WEEKDAYS_SHORT } from '../../format.ts';
import { usePanel } from './PanelLayout.tsx';

type StaffRow = ManageData['staff'][number];
type Block = { weekday: number; start: string; end: string };

export function Staff() {
  const { data } = usePanel();
  const [adding, setAdding] = useState(false);
  const [editingHours, setEditingHours] = useState<StaffRow | null>(null);
  const [editing, setEditing] = useState<StaffRow | null>(null);

  return (
    <div className="stack">
      <div className="spread">
        <p className="muted">Çalışanlar, verdikleri hizmetler ve haftalık çalışma saatleri.</p>
        <button className="btn" onClick={() => setAdding(true)}>+ Çalışan ekle</button>
      </div>
      {data.staff.length === 0 && <Empty title="Henüz çalışan yok">Randevu alınabilmesi için en az bir çalışan gerekir.</Empty>}
      <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        {data.staff.map((s) => (
          <article key={s.id} className={`card card--pad stack ${s.active ? '' : 'is-inactive'}`} style={{ '--gap': '12px' } as React.CSSProperties}>
            <div className="spread">
              <div>
                <h3 style={{ fontSize: 19 }}>{s.displayName}</h3>
                <div className="muted small">{s.title || 'Çalışan'}{s.email ? ` · ${s.email}` : ' · Giriş hesabı yok'}</div>
              </div>
              {!s.active && <span className="badge badge--cancelled">Pasif</span>}
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Hizmetler</div>
              <div className="row" style={{ '--gap': '6px' } as React.CSSProperties}>
                {s.serviceIds.length === 0 && <span className="muted small">Hizmet atanmamış</span>}
                {s.serviceIds.map((id) => (
                  <span key={id} className="chip">{data.services.find((sv) => sv.id === id)?.name}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Çalışma saatleri</div>
              <HoursSummary blocks={s.workingHours} />
            </div>
            <div className="row" style={{ marginTop: 'auto' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditingHours(s)}>Saatleri düzenle</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(s)}>Bilgiler & hizmetler</button>
            </div>
          </article>
        ))}
      </div>
      {adding && <StaffDialog staff={null} onClose={() => setAdding(false)} />}
      {editing && <StaffDialog staff={editing} onClose={() => setEditing(null)} />}
      {editingHours && <HoursDialog staff={editingHours} onClose={() => setEditingHours(null)} />}
    </div>
  );
}

function HoursSummary({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) return <span className="muted small">Saat girilmemiş — randevu alınamaz</span>;
  return (
    <div className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
      {WEEKDAYS.map((name, i) => {
        const day = blocks.filter((b) => b.weekday === i + 1);
        return (
          <div key={name} style={{ display: 'contents' }}>
            <span className="muted">{WEEKDAYS_SHORT[i]}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{day.length ? day.map((b) => `${b.start}–${b.end}`).join(', ') : 'Kapalı'}</span>
          </div>
        );
      })}
    </div>
  );
}

function HoursDialog({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const { data } = usePanel();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [blocks, setBlocks] = useState<Block[]>(staff.workingHours);

  const update = (index: number, patch: Partial<Block>) => setBlocks(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const save = useMutation({
    mutationFn: () => api(`/staff/${staff.id}/working-hours`, { method: 'PUT', body: { blocks } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manage', data.business.id] });
      queryClient.invalidateQueries({ queryKey: ['availability', data.business.id] });
      toast('Çalışma saatleri kaydedildi.');
      onClose();
    },
  });
  const copyMondayToWeekdays = () => {
    const monday = blocks.filter((b) => b.weekday === 1);
    setBlocks([...monday, ...[2, 3, 4, 5].flatMap((weekday) => monday.map((b) => ({ ...b, weekday }))), ...blocks.filter((b) => b.weekday >= 6)]);
  };

  return (
    <Modal title={`${staff.displayName} — çalışma saatleri`} onClose={onClose}>
      <p className="muted small" style={{ margin: '4px 0 12px' }}>Öğle arası için güne iki ayrı aralık ekleyin (ör. 09:00–12:00 ve 13:00–18:00).</p>
      <div className="week-editor">
        {WEEKDAYS.map((name, i) => {
          const weekday = i + 1;
          return (
            <div key={name} className="week-editor__day">
              <strong>{name}</strong>
              <div className="week-editor__blocks">
                {blocks.map((b, index) =>
                  b.weekday !== weekday ? null : (
                    <span key={index} className="block-input">
                      <input type="time" step={900} value={b.start} aria-label={`${name} başlangıç`} onChange={(e) => update(index, { start: e.target.value })} />
                      –
                      <input type="time" step={900} value={b.end} aria-label={`${name} bitiş`} onChange={(e) => update(index, { end: e.target.value })} />
                      <button type="button" className="icon-btn" aria-label="Aralığı sil" onClick={() => setBlocks(blocks.filter((_, j) => j !== index))}>×</button>
                    </span>
                  ),
                )}
                <button type="button" className="link-btn small" onClick={() => setBlocks([...blocks, { weekday, start: '09:00', end: '18:00' }])}>
                  + aralık
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {save.error && <div className="form-error" style={{ marginTop: 12 }}>{errorMessage(save.error)}</div>}
      <div className="spread" style={{ marginTop: 18 }}>
        <button type="button" className="link-btn small" onClick={copyMondayToWeekdays}>Pazartesiyi hafta içine kopyala</button>
        <div className="row">
          <button className="btn btn--ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn" disabled={save.isPending} onClick={() => save.mutate()}>Kaydet</button>
        </div>
      </div>
    </Modal>
  );
}

function StaffDialog({ staff, onClose }: { staff: StaffRow | null; onClose: () => void }) {
  const { data } = usePanel();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    displayName: staff?.displayName ?? '',
    title: staff?.title ?? '',
    email: '',
    active: staff?.active ?? true,
    serviceIds: staff?.serviceIds ?? [],
  });
  const save = useMutation({
    mutationFn: () =>
      staff
        ? api(`/staff/${staff.id}`, { method: 'PATCH', body: { displayName: form.displayName, title: form.title, active: form.active, serviceIds: form.serviceIds } })
        : api(`/businesses/${data.business.id}/staff`, {
            body: { displayName: form.displayName, title: form.title, serviceIds: form.serviceIds, ...(form.email ? { email: form.email } : {}) },
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manage', data.business.id] });
      queryClient.invalidateQueries({ queryKey: ['business', data.business.slug] });
      toast(staff ? 'Çalışan güncellendi.' : 'Çalışan eklendi. Şimdi çalışma saatlerini girin.');
      onClose();
    },
  });

  return (
    <Modal title={staff ? 'Çalışanı düzenle' : 'Çalışan ekle'} onClose={onClose}>
      <form
        className="stack"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Ad soyad</span>
            <input className="input" required minLength={2} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </label>
          <label className="field">
            <span>Ünvan</span>
            <input className="input" placeholder="Stilist, Diyetisyen…" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
        </div>
        {!staff && (
          <label className="field">
            <span>E-posta (isteğe bağlı)</span>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <small className="muted">Kayıtlı bir kullanıcının e-postasını girerseniz kendi takvimini görebilir ve izin girebilir.</small>
          </label>
        )}
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Verdiği hizmetler</span>
          <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
            {data.services.map((sv) => (
              <label key={sv.id} className="check">
                <input
                  type="checkbox"
                  checked={form.serviceIds.includes(sv.id)}
                  onChange={(e) =>
                    setForm({ ...form, serviceIds: e.target.checked ? [...form.serviceIds, sv.id] : form.serviceIds.filter((id) => id !== sv.id) })
                  }
                />
                {sv.name}
              </label>
            ))}
            {data.services.length === 0 && <span className="muted small">Önce Hizmetler sekmesinden hizmet ekleyin.</span>}
          </div>
        </fieldset>
        {staff && (
          <label className="check" style={{ alignSelf: 'flex-start' }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Aktif (randevu alabilir)
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
