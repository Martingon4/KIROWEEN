export function formatTime(ms: number | null): string {
  return ms === null ? '-' : new Date(ms).toLocaleString('es');
}

export function remaining(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return '-';
  const s = Math.max(0, Math.floor((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function money(preview: Record<string, unknown>): string {
  const c = preview.amountCents;
  const cur = preview.currency;
  if (typeof c !== 'number' || !Number.isSafeInteger(c) || typeof cur !== 'string') return '-';
  const abs = Math.abs(c);
  return `${cur} ${c < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<string, { icon: string; text: string; tone: string }> = {
  pending_approval: { icon: '\u23F3', text: 'Pendiente', tone: 'warn' },
  approved: { icon: '\u2714', text: 'Aprobada', tone: 'ok' },
  executed: { icon: '\u2714', text: 'Ejecutada', tone: 'ok' },
  denied: { icon: '\u2716', text: 'Rechazada', tone: 'bad' },
  blocked: { icon: '\u26D4', text: 'Bloqueada', tone: 'bad' },
  expired: { icon: '\u231B', text: 'Expirada', tone: 'muted' },
  failed: { icon: '\u26A0', text: 'Fallida', tone: 'bad' },
};
