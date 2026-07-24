import { useEffect, useState, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={wide ? { width: 'min(760px, 100%)' } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {hint ? <div style={{ marginTop: 6 }}>{hint}</div> : null}
    </div>
  );
}

export function Toast({ message, tone }: { message: string; tone: 'ok' | 'error' }) {
  return <div className={`toast ${tone === 'error' ? 'error' : ''}`}>{message}</div>;
}

export interface ToastState {
  message: string;
  tone: 'ok' | 'error';
}

/** Small helper so pages can flash a message without wiring up state each time. */
export function useToast(): [ReactNode, (message: string, tone?: 'ok' | 'error') => void] {
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  const show = (message: string, tone: 'ok' | 'error' = 'ok') => setToast({ message, tone });
  return [toast ? <Toast message={toast.message} tone={toast.tone} /> : null, show];
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
