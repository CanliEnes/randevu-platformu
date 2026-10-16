import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router';
import { api, errorMessage, type ManageData } from '../../api.ts';
import { useMe } from '../../auth.tsx';
import { Empty, Skeleton, useToast } from '../../components/ui.tsx';
import { useLiveAppointments, type LiveStatus } from '../../hooks/useLiveAppointments.ts';

export interface PanelContext {
  data: ManageData;
  isOwner: boolean;
  fresh: Set<number>;
}

export const usePanel = () => useOutletContext<PanelContext>();

/** Sends the user to their first business, or offers to create one. */
export function PanelIndex() {
  const { data: me } = useMe();
  const first = me?.memberships[0];
  if (first) return <Navigate to={`/panel/${first.businessId}`} replace />;
  return <Navigate to="/panel/yeni" replace />;
}

export function PanelLayout() {
  const businessId = Number(useParams().businessId);
  const { data: me } = useMe();
  const toast = useToast();
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const { data, isLoading, isError } = useQuery({
    queryKey: ['manage', businessId],
    queryFn: () => api<ManageData>(`/businesses/${businessId}/manage`),
  });

  const live = useLiveAppointments(businessId, (event) => {
    if (event.type === 'created') {
      toast('Yeni randevu geldi! Takvim güncellendi.');
      setFresh((set) => new Set(set).add(event.appointmentId));
    } else if (event.type === 'cancelled') {
      toast('Bir randevu iptal edildi.');
    }
  });

  if (isLoading) {
    return (
      <div className="container page stack">
        <Skeleton height={60} />
        <Skeleton height={480} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="container page">
        <Empty title="Bu işletmeye erişiminiz yok">
          <Link to="/" className="btn">Ana sayfa</Link>
        </Empty>
      </div>
    );
  }

  const isOwner = data.role === 'owner';
  const memberships = me?.memberships ?? [];
  const tabs = [
    { to: '', label: 'Takvim', end: true },
    ...(isOwner ? [{ to: 'hizmetler', label: 'Hizmetler' }, { to: 'calisanlar', label: 'Çalışanlar' }] : []),
    { to: 'izinler', label: 'İzinler' },
    ...(isOwner ? [{ to: 'istatistik', label: 'İstatistikler' }, { to: 'ayarlar', label: 'Ayarlar' }] : []),
  ];

  return (
    <div className="container" style={{ paddingBottom: 72 }}>
      <div className="panel-head">
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <div className="row" style={{ '--gap': '10px' } as React.CSSProperties}>
            <span className="chip">{isOwner ? 'İşletme sahibi' : 'Çalışan'}</span>
            <LiveBadge status={live} />
          </div>
          <h1>{data.business.name}</h1>
        </div>
        <div className="row">
          {memberships.length > 1 && <BusinessSwitcher current={businessId} />}
          <Link to={`/isletme/${data.business.slug}`} className="btn btn--ghost btn--sm">Herkese açık sayfa ↗</Link>
        </div>
      </div>
      <nav className="panel-tabs" aria-label="Panel">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet context={{ data, isOwner, fresh } satisfies PanelContext} />
    </div>
  );
}

function LiveBadge({ status }: { status: LiveStatus }) {
  const label = { live: 'Canlı', connecting: 'Bağlanıyor…', offline: 'Bağlantı yok' }[status];
  return (
    <span className={`live ${status === 'live' ? 'live--on' : ''}`} title="Yeni randevular sayfayı yenilemeden görünür">
      <span className="live__dot" aria-hidden /> {label}
    </span>
  );
}

function BusinessSwitcher({ current }: { current: number }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  return (
    <select className="select" style={{ minHeight: 34, width: 'auto' }} value={current} onChange={(e) => navigate(`/panel/${e.target.value}`)} aria-label="İşletme seç">
      {me?.memberships.map((m) => (
        <option key={m.businessId} value={m.businessId}>{m.name}</option>
      ))}
    </select>
  );
}

const slugify = (text: string) =>
  text
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export function CreateBusiness() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', category: '', address: '', description: '', ownerIsStaff: true });
  const [slugTouched, setSlugTouched] = useState(false);
  const create = useMutation({
    mutationFn: () => api<{ business: { id: number } }>('/businesses', { body: form }),
    onSuccess: async ({ business }) => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('İşletmen oluşturuldu! Şimdi hizmetleri ve çalışma saatlerini ekle.');
      navigate(`/panel/${business.id}/hizmetler`);
    },
  });

  return (
    <div className="container page" style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 36 }}>İşletmeni ekle</h1>
      <p className="muted" style={{ margin: '8px 0 24px' }}>Müşterilerin birkaç dakika içinde senden online randevu alabilir.</p>
      <form
        className="card card--pad stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        {create.error && <div className="form-error">{errorMessage(create.error)}</div>}
        <label className="field">
          <span>İşletme adı</span>
          <input
            className="input"
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugTouched ? form.slug : slugify(e.target.value) })}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Sayfa adresi</span>
            <input
              className="input"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm({ ...form, slug: slugify(e.target.value) });
              }}
            />
            <small className="muted">sıradaki.app/isletme/{form.slug || '…'}</small>
          </label>
          <label className="field">
            <span>Kategori</span>
            <input className="input" required list="categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="categories">
              {['Kuaför', 'Berber', 'Güzellik Salonu', 'Diyetisyen', 'Psikolog', 'Dövme Stüdyosu', 'Pet Kuaförü', 'Fizyoterapist'].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="field">
          <span>Adres</span>
          <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label className="field">
          <span>Kısa tanıtım</span>
          <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label className="check" style={{ alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={form.ownerIsStaff} onChange={(e) => setForm({ ...form, ownerIsStaff: e.target.checked })} />
          Ben de randevu alıyorum (beni çalışan olarak ekle)
        </label>
        <button className="btn" disabled={create.isPending} style={{ alignSelf: 'flex-start' }}>
          {create.isPending ? 'Oluşturuluyor…' : 'İşletmeyi oluştur'}
        </button>
      </form>
    </div>
  );
}
