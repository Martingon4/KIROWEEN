import type { ReactNode } from 'react';
import styles from './app.module.css';
import { STATUS_LABEL } from './format';

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { icon: '?', text: status, tone: 'muted' };
  const tone = s.tone === 'muted' ? styles['mutedTone'] : styles[s.tone];
  return (
    <span className={`${styles['badge']} ${tone ?? ''}`}>
      <span aria-hidden="true">{s.icon}</span> {s.text}
    </span>
  );
}

export function State({
  loading,
  error,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}) {
  if (error)
    return (
      <p role="alert" className={styles['error']}>
        No se pudo cargar ({error}).
      </p>
    );
  if (loading)
    return (
      <p role="status" className={styles['empty']}>
        Cargando...
      </p>
    );
  if (empty) return <p className={styles['empty']}>{emptyText ?? 'Sin datos.'}</p>;
  return <>{children}</>;
}
