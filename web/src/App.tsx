import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useLogout, useMe } from './auth.tsx';
import { Logo, Skeleton } from './components/ui.tsx';
import { initials } from './format.ts';
import { BusinessPage } from './pages/Business.tsx';
import { Home } from './pages/Home.tsx';
import { Login, Register } from './pages/Auth.tsx';
import { Mailbox } from './pages/Mailbox.tsx';
import { MyAppointments } from './pages/MyAppointments.tsx';
import { CreateBusiness, PanelIndex, PanelLayout } from './pages/panel/PanelLayout.tsx';
import { Calendar } from './pages/panel/Calendar.tsx';
import { Services } from './pages/panel/Services.tsx';
import { Staff } from './pages/panel/Staff.tsx';
import { TimeOff } from './pages/panel/TimeOff.tsx';
import { Settings } from './pages/panel/Settings.tsx';

// The charts library is large, so the statistics page is downloaded only when opened.
const StatsPage = lazy(() => import('./pages/panel/Stats.tsx').then((m) => ({ default: m.StatsPage })));

export function App() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <TopBar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/isletme/:slug" element={<BusinessPage />} />
          <Route path="/giris" element={<Login />} />
          <Route path="/kayit" element={<Register />} />
          <Route path="/randevularim" element={<RequireAuth><MyAppointments /></RequireAuth>} />
          <Route path="/posta" element={<RequireAuth><Mailbox /></RequireAuth>} />
          <Route path="/panel" element={<RequireAuth><PanelIndex /></RequireAuth>} />
          <Route path="/panel/yeni" element={<RequireAuth><CreateBusiness /></RequireAuth>} />
          <Route path="/panel/:businessId" element={<RequireAuth><PanelLayout /></RequireAuth>}>
            <Route index element={<Calendar />} />
            <Route path="hizmetler" element={<Services />} />
            <Route path="calisanlar" element={<Staff />} />
            <Route path="izinler" element={<TimeOff />} />
            <Route path="istatistik" element={<Suspense fallback={<Skeleton height={320} />}><StatsPage /></Suspense>} />
            <Route path="ayarlar" element={<Settings />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">
        <div className="container spread">
          <span>Sıradaki — bir portföy projesi. Fastify · PostgreSQL · React</span>
          <span>Bu bir demodur; gerçek randevu oluşturulmaz.</span>
        </div>
      </footer>
    </>
  );
}

function TopBar() {
  const { data: me } = useMe();
  const isManager = (me?.memberships.length ?? 0) > 0;
  return (
    <header className="topbar">
      <div className="container topbar__inner">
        <Link to="/" className="logo">
          <Logo />
          Sıradaki
        </Link>
        <nav className="nav" aria-label="Ana menü">
          <NavLink to="/" end className="nav__optional">Keşfet</NavLink>
          {me && <NavLink to="/randevularim">Randevularım</NavLink>}
          {me && isManager && <NavLink to="/panel">Panel</NavLink>}
          {me === null && (
            <Link to="/giris" className="btn btn--sm" style={{ color: 'var(--brand-ink)', marginLeft: 8 }}>
              Giriş yap
            </Link>
          )}
          {me && <UserMenu name={me.user.fullName} email={me.user.email} isManager={isManager} />}
        </nav>
      </div>
    </header>
  );
}

function UserMenu({ name, email, isManager }: { name: string; email: string; isManager: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="user-menu" ref={ref} style={{ marginLeft: 8 }}>
      <button className="avatar" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Hesap menüsü">
        {initials(name)}
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown__head">
            <strong>{name}</strong>
            <div className="muted small">{email}</div>
          </div>
          <Link to="/randevularim">Randevularım</Link>
          <Link to="/posta">Posta kutusu (demo)</Link>
          <Link to={isManager ? '/panel' : '/panel/yeni'}>{isManager ? 'İşletme paneli' : 'İşletmemi ekle'}</Link>
          <button onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/') })}>Çıkış yap</button>
        </div>
      )}
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="container page stack">
        <Skeleton height={48} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (!me) return <Navigate to={`/giris?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="container page">
      <div className="empty">
        <h3>Bu sayfa bulunamadı</h3>
        <p>Adres yanlış yazılmış ya da sayfa kaldırılmış olabilir.</p>
        <Link to="/" className="btn">Ana sayfaya dön</Link>
      </div>
    </div>
  );
}
