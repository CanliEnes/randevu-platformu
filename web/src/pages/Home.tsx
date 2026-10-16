import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage, type BusinessSummary } from '../api.ts';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, useLogin, useMe } from '../auth.tsx';
import { Empty, Skeleton, useToast } from '../components/ui.tsx';
import { businessColor, initials, money } from '../format.ts';

export function Home() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['businesses'],
    queryFn: () => api<{ businesses: BusinessSummary[] }>('/businesses'),
  });

  const businesses = data?.businesses ?? [];
  const categories = useMemo(() => [...new Set(businesses.map((b) => b.category))].sort((a, b) => a.localeCompare(b, 'tr')), [businesses]);
  const visible = businesses.filter((b) => {
    const q = query.trim().toLocaleLowerCase('tr');
    const matches = !q || `${b.name} ${b.category} ${b.address}`.toLocaleLowerCase('tr').includes(q);
    return matches && (!category || b.category === category);
  });

  return (
    <>
      <section className="hero">
        <div className="container hero__grid">
          <div>
            <p className="eyebrow">Kuaför · Diyetisyen · Dövme · Pet kuaförü</p>
            <h1 style={{ marginTop: 14 }}>
              Sıradaki randevun <em>üç tıkla</em> hazır.
            </h1>
            <p className="hero__lead">
              Telefonda beklemek yok. İşletmeyi seç, boş saatleri anında gör, randevunu al. Hatırlatma e-postası bizden.
            </p>
            <form
              className="search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                document.getElementById('isletmeler')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <label htmlFor="search" className="sr-only">İşletme ara</label>
              <input
                id="search"
                placeholder="İşletme, hizmet veya semt ara…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="btn">Ara</button>
            </form>
          </div>
          <TicketIllustration />
        </div>
      </section>

      <div className="container">
        <DemoStrip />

        <section id="isletmeler" style={{ paddingBottom: 64 }}>
          <div className="spread" style={{ marginBottom: 14 }}>
            <h2 className="section-title" style={{ margin: 0 }}>İşletmeler</h2>
            {data && <span className="muted small">{visible.length} işletme</span>}
          </div>
          {categories.length > 1 && (
            <div className="categories" aria-label="Kategoriler">
              <button aria-pressed={category === null} onClick={() => setCategory(null)}>Tümü</button>
              {categories.map((c) => (
                <button key={c} aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {isLoading && <div className="biz-grid"><Skeleton height={290} count={4} /></div>}
          {isError && <Empty title="İşletmeler yüklenemedi">Sunucu çalışıyor mu? Sayfayı yenilemeyi deneyin.</Empty>}
          {data && visible.length === 0 && (
            <Empty title="Sonuç yok">
              <p>“{query}” için bir işletme bulamadık. Başka bir kelime deneyin.</p>
            </Empty>
          )}
          <div className="biz-grid">
            {visible.map((b, i) => (
              <Link key={b.id} to={`/isletme/${b.slug}`} className="card biz-card" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="biz-card__art" style={{ background: businessColor(b.slug) }} aria-hidden>
                  {initials(b.name)}
                </div>
                <div className="biz-card__body">
                  <span className="chip" style={{ alignSelf: 'flex-start' }}>{b.category}</span>
                  <h3>{b.name}</h3>
                  <p className="muted small">{b.address}</p>
                  <div className="biz-card__foot">
                    {b.rating !== null ? (
                      <span className="rating">
                        <span className="rating__star" aria-hidden>★</span> {b.rating.toFixed(1)}
                        <span className="muted" style={{ fontWeight: 400 }}>({b.reviewCount})</span>
                      </span>
                    ) : (
                      <span className="muted">Yeni</span>
                    )}
                    {b.minPriceCents !== null && <span className="muted">{money(b.minPriceCents)}’den başlayan</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

/** Decorative "appointment ticket" next to the headline. */
function TicketIllustration() {
  const slots = [
    ['10:00', 'is-taken'], ['10:30', ''], ['11:00', 'is-taken'], ['11:30', ''],
    ['14:00', 'is-picked'], ['14:30', ''], ['15:00', 'is-taken'], ['15:30', ''],
  ];
  return (
    <div className="card hero__ticket" aria-hidden>
      <div className="spread">
        <div>
          <div className="eyebrow">Makas & Tarak</div>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>Erkek Saç Kesimi</strong>
        </div>
        <span className="chip">30 dk</span>
      </div>
      <div className="ticket__slots">
        {slots.map(([t, cls]) => (
          <span key={t} className={cls}>{t}</span>
        ))}
      </div>
      <div className="ticket__foot spread">
        <div>
          <div className="muted small">Salı · Mert Yıldız</div>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 26 }}>14:00</strong>
        </div>
        <span className="btn btn--accent btn--sm">Onaylandı ✓</span>
      </div>
    </div>
  );
}

/** One-click logins for portfolio visitors who just want to look around. */
function DemoStrip() {
  const { data: me } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const toast = useToast();
  if (me) return null;
  const go = (email: string) =>
    login.mutate(
      { email, password: DEMO_PASSWORD },
      {
        onSuccess: () => navigate(email === 'musteri@demo.test' ? '/randevularim' : '/panel'),
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    );
  return (
    <div className="demo-strip">
      <div>
        <strong>Hesap açmadan dene</strong>
        <div className="small" style={{ opacity: 0.75 }}>Hazır demo hesaplarından biriyle tek tıkla gir.</div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', '--gap': '8px' } as React.CSSProperties}>
        {DEMO_ACCOUNTS.map((a) => (
          <button key={a.email} className="btn btn--ghost btn--sm" disabled={login.isPending} onClick={() => go(a.email)}>
            {a.label} olarak gir
          </button>
        ))}
      </div>
    </div>
  );
}
