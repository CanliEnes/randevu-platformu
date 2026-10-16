import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../api.ts';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, useLogin, useRegister } from '../auth.tsx';

/** Only follow "next" links that stay on this site. */
function useNext() {
  const [params] = useSearchParams();
  const next = params.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function Login() {
  const next = useNext();
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (credentials: { email: string; password: string }) =>
    login.mutate(credentials, { onSuccess: () => navigate(next, { replace: true }) });

  return (
    <div className="auth">
      <div className="card auth__card">
        <h1>Tekrar hoş geldin</h1>
        <p className="muted" style={{ marginBottom: 22 }}>Randevularını görmek için giriş yap.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ email, password });
          }}
        >
          {login.error && <div className="form-error" role="alert">{errorMessage(login.error)}</div>}
          <label className="field">
            <span>E-posta</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Şifre</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn btn--block" disabled={login.isPending}>
            {login.isPending ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </button>
        </form>

        <div style={{ marginTop: 24 }}>
          <div className="eyebrow">Demo hesapları</div>
          <div className="demo-logins">
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" disabled={login.isPending} onClick={() => submit({ email: a.email, password: DEMO_PASSWORD })}>
                <span>
                  <strong>{a.label}</strong>
                  <span className="muted"> · {a.who}</span>
                </span>
                <span aria-hidden>→</span>
              </button>
            ))}
          </div>
        </div>

        <p className="muted small" style={{ marginTop: 22, textAlign: 'center' }}>
          Hesabın yok mu? <Link to={`/kayit${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Kayıt ol</Link>
        </p>
      </div>
    </div>
  );
}

export function Register() {
  const next = useNext();
  const navigate = useNavigate();
  const register = useRegister();
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="auth">
      <div className="card auth__card">
        <h1>Hesap oluştur</h1>
        <p className="muted" style={{ marginBottom: 22 }}>Bir dakikadan kısa sürer. Kredi kartı gerekmez.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            register.mutate(form, { onSuccess: () => navigate(next, { replace: true }) });
          }}
        >
          {register.error && <div className="form-error" role="alert">{errorMessage(register.error)}</div>}
          <label className="field">
            <span>Ad soyad</span>
            <input className="input" autoComplete="name" required minLength={2} value={form.fullName} onChange={set('fullName')} />
          </label>
          <label className="field">
            <span>E-posta</span>
            <input className="input" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
          </label>
          <label className="field">
            <span>Şifre</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
            <small className="muted">En az 8 karakter.</small>
          </label>
          <button className="btn btn--block" disabled={register.isPending}>
            {register.isPending ? 'Hesap oluşturuluyor…' : 'Kayıt ol'}
          </button>
        </form>
        <p className="muted small" style={{ marginTop: 22, textAlign: 'center' }}>
          Zaten hesabın var mı? <Link to={`/giris${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Giriş yap</Link>
        </p>
      </div>
    </div>
  );
}
