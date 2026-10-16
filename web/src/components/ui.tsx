import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------- Toasts ----------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const show = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast--error' : ''}`}>
            {t.kind === 'info' && <span className="toast__dot" aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Modal ----------

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------- Small pieces ----------

export function Stars({ value, size }: { value: number; size?: number }) {
  const rounded = Math.round(value);
  return (
    <span className="stars" style={size ? { fontSize: size } : undefined} aria-label={`5 üzerinden ${value}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= rounded ? '' : 'off'} aria-hidden>
          ★
        </span>
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const labels = ['Çok kötü', 'Kötü', 'Fena değil', 'İyi', 'Harika'];
  return (
    <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
      <div className="star-input" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            className={i <= (hover || value) ? 'on' : ''}
            onMouseEnter={() => setHover(i)}
            onClick={() => onChange(i)}
            aria-label={`${i} yıldız`}
            aria-pressed={value === i}
          >
            ★
          </button>
        ))}
      </div>
      <span className="muted small">{labels[(hover || value) - 1] ?? 'Puan seçin'}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Skeleton({ height = 120, count = 1 }: { height?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} aria-hidden />
      ))}
    </>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    upcoming: 'Yaklaşan', in_progress: 'Şu an', completed: 'Tamamlandı', cancelled: 'İptal edildi', no_show: 'Gelmedi',
  };
  return <span className={`badge badge--${status}`}>{labels[status] ?? status}</span>;
}

export function Logo() {
  return (
    <svg className="logo__mark" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#1f4d3f" />
      <rect x="14" y="18" width="36" height="32" rx="6" fill="none" stroke="#f4efe6" strokeWidth="4" />
      <path d="M14 28h36M24 12v10M40 12v10" stroke="#f4efe6" strokeWidth="4" strokeLinecap="round" />
      <circle cx="32" cy="39" r="5" fill="#f08a4b" />
    </svg>
  );
}
