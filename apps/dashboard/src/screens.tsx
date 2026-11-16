import { useState } from 'react';
import { api, ApiError } from './api';
import type { PolicyDto, RequestDto } from './api';
import styles from './app.module.css';
import { formatTime, money, remaining } from './format';
import { useLoad } from './useLoad';
import { useNow } from './useEvents';
import { State, StatusBadge } from './ui';

export function Login({ onDone }: { onDone: () => void }) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className={styles['main']}>
      <h1>MCP Guard</h1>
      <p className={styles['muted']}>
        Inicie sesion con el secreto local del panel (DASHBOARD_ADMIN_SECRET). El agente no lo
        tiene.
      </p>
      <form
        className={styles['form']}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          api
            .login(secret)
            .then(() => onDone())
            .catch((err: unknown) =>
              setError(
                err instanceof ApiError && err.status === 429
                  ? 'Demasiados intentos.'
                  : 'Secreto incorrecto.',
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Secreto del panel
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <button className={`${styles['btn']} ${styles['primary']}`} disabled={busy}>
          Entrar
        </button>
      </form>
      {error && (
        <p role="alert" className={styles['bad']}>
          {error}
        </p>
      )}
    </main>
  );
}

export function Home({ tick, demoMode }: { tick: number; demoMode: boolean }) {
  const s = useLoad(() => api.summary(), [tick]);
  const [msg, setMsg] = useState<string | null>(null);
  const d = s.data;
  return (
    <section aria-labelledby="h-home">
      <h1 id="h-home">Estado</h1>
      <State loading={s.loading} error={s.error}>
        {d && (
          <>
            <div className={styles['cards']}>
              <div className={styles['card']}>
                <div className={styles['muted']}>Guard</div>
                <div className={d.policyMode === 'active' ? styles['ok'] : styles['bad']}>
                  {d.policyMode === 'active' ? '\u2714 Politica activa' : '\u26D4 Modo bloqueado'}
                </div>
              </div>
              <div className={styles['card']}>
                <div className={styles['muted']}>Tienda simulada</div>
                <div className={d.upstream === 'up' ? styles['ok'] : styles['bad']}>
                  {d.upstream === 'up' ? '\u2714 Conectada' : '\u26A0 Sin conexion'}
                </div>
              </div>
              <div className={styles['card']}>
                <div className={styles['muted']}>Auditoria</div>
                <div>{d.database === 'ok' ? 'PostgreSQL' : '\u26A0 Solo memoria'}</div>
              </div>
            </div>
            <div className={styles['cards']}>
              {(
                [
                  ['Pendientes', d.pending],
                  ['Permitidas', d.allowed],
                  ['Aprobadas', d.approved],
                  ['Rechazadas', d.rejected],
                  ['Bloqueadas', d.blocked],
                ] as const
              ).map(([label, n]) => (
                <div className={styles['card']} key={label}>
                  <div className={styles['big']}>{n}</div>
                  <div className={styles['muted']}>{label}</div>
                </div>
              ))}
            </div>
            <p>
              <a href="#/inbox">Ir a la bandeja</a> · <a href="#/audit">Ver historial</a>
            </p>
          </>
        )}
      </State>
      {demoMode && (
        <div className={styles['card']}>
          <h2>Modo demo</h2>
          <div className={styles['actions']}>
            {[false, true].map((clear) => (
              <button
                key={String(clear)}
                className={styles['btn']}
                onClick={() => {
                  const text = clear
                    ? 'Restaurar datos semilla Y borrar la auditoria demo?'
                    : 'Restaurar datos semilla de la tienda?';
                  if (!window.confirm(text)) return;
                  api
                    .resetDemo(clear)
                    .then(() => setMsg('Hecho.'))
                    .catch(() => setMsg('No se pudo restaurar.'));
                }}
              >
                {clear ? 'Restaurar y limpiar auditoria' : 'Restaurar datos semilla'}
              </button>
            ))}
          </div>
          {msg && <p role="status">{msg}</p>}
        </div>
      )}
    </section>
  );
}

export function Inbox({ tick }: { tick: number }) {
  const p = useLoad(() => api.pending(), [tick]);
  const now = useNow();
  return (
    <section aria-labelledby="h-inbox">
      <h1 id="h-inbox">Bandeja de aprobaciones</h1>
      <State
        loading={p.loading}
        error={p.error}
        empty={p.data?.pending.length === 0}
        emptyText="No hay solicitudes pendientes."
      >
        {p.data?.pending.map((r) => (
          <a key={r.id} className={styles['row']} href={`#/action/${r.id}`}>
            <StatusBadge status={r.status} />
            {r.expiresAt !== null && r.expiresAt - now < 30000 && (
              <span className={`${styles['badge']} ${styles['bad']}`}>Caduca pronto</span>
            )}
            <strong> {r.description}</strong>
            <div className={styles['muted']}>
              <span className={styles['code']}>{r.id}</span> {formatTime(r.requestedAt)} ·{' '}
              {r.upstream}/{r.tool} · {money(r.preview)} · Tiempo restante{' '}
              {remaining(r.expiresAt, now)}
            </div>
            <div>{r.reason}</div>
          </a>
        ))}
      </State>
    </section>
  );
}

export function Detail({ id, tick }: { id: string; tick: number }) {
  const a = useLoad(() => api.action(id), [id, tick]);
  const now = useNow();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = a.data?.request;

  const act = (kind: 'approve' | 'deny') => {
    const text =
      kind === 'approve'
        ? 'Aprobar y ejecutar esta accion simulada una sola vez?'
        : 'Rechazar esta solicitud? No se ejecutara.';
    if (!window.confirm(text)) return;
    setBusy(true);
    (kind === 'approve' ? api.approve(id) : api.deny(id))
      .then(() => setErr(null))
      .catch((e: unknown) =>
        setErr(e instanceof ApiError ? `No se pudo completar (${e.code}).` : 'Error de red.'),
      )
      .finally(() => {
        setBusy(false);
        a.reload();
      });
  };

  return (
    <section aria-labelledby="h-detail">
      <p>
        <a href="#/inbox">Volver a la bandeja</a>
      </p>
      <State loading={a.loading} error={a.error}>
        {r && (
          <DetailBody
            r={r}
            now={now}
            busy={busy}
            err={err}
            act={act}
            events={a.data?.events ?? []}
          />
        )}
      </State>
    </section>
  );
}

function DetailBody(props: {
  r: RequestDto;
  now: number;
  busy: boolean;
  err: string | null;
  act: (k: 'approve' | 'deny') => void;
  events: Array<{ id: string; eventType: string; actor: string; createdAt: number }>;
}) {
  const { r, now, busy, err, act, events } = props;
  const pending = r.status === 'pending_approval';
  return (
    <>
      <h1 id="h-detail">{r.description}</h1>
      <p>
        <StatusBadge status={r.status} />
        {pending ? `Tiempo restante ${remaining(r.expiresAt, now)}` : null}
      </p>
      <div className={styles['notice']} role="note">
        {r.reachedTarget
          ? 'La accion simulada llego al sistema de destino.'
          : 'No se ha llamado al sistema de destino.'}
        {pending && ' La accion simulada se ejecutara al aprobar, una sola vez.'}
      </div>
      <dl>
        <dt>Sistema y herramienta</dt>
        <dd>
          {r.upstream} / {r.tool}
        </dd>
        <dt>Regla</dt>
        <dd>
          {r.ruleName ?? 'ninguna'} ({r.ruleId ?? '-'}): {r.reason}
        </dd>
        <dt>Datos permitidos por la regla</dt>
        <dd>
          <ul>
            {Object.entries(r.preview).map(([k, v]) => (
              <li key={k}>
                {k}: <span className={styles['code']}>{String(v)}</span>
              </li>
            ))}
          </ul>
        </dd>
        <dt>Hash de la llamada (SHA-256, corto)</dt>
        <dd className={styles['code']}>{r.hashShort}</dd>
        {r.approvedBy && (
          <>
            <dt>Revisor</dt>
            <dd>{r.approvedBy}</dd>
          </>
        )}
        {r.resultSummary && (
          <>
            <dt>Resultado</dt>
            <dd>{r.resultSummary}</dd>
          </>
        )}
        {r.errorCode && (
          <>
            <dt>Error</dt>
            <dd>{r.errorCode}</dd>
          </>
        )}
      </dl>
      {pending && (
        <div className={styles['actions']}>
          <button
            className={`${styles['btn']} ${styles['primary']}`}
            disabled={busy}
            onClick={() => act('approve')}
          >
            Aprobar y ejecutar simulación
          </button>
          <button
            className={`${styles['btn']} ${styles['danger']}`}
            disabled={busy}
            onClick={() => act('deny')}
          >
            Rechazar
          </button>
        </div>
      )}
      {err && (
        <p role="alert" className={styles['bad']}>
          {err}
        </p>
      )}
      <h2>Secuencia de eventos</h2>
      <ol className={styles['timeline']}>
        {events.map((e) => (
          <li key={e.id}>
            {formatTime(e.createdAt)} · <strong>{e.eventType}</strong> · {e.actor}
          </li>
        ))}
      </ol>
    </>
  );
}

export function Audit({ tick }: { tick: number }) {
  const [status, setStatus] = useState('');
  const [tool, setTool] = useState('');
  const [from, setFrom] = useState('');
  const q: Record<string, string> = {};
  if (status) q['status'] = status;
  if (tool) q['tool'] = tool;
  if (from) q['from'] = from;
  const a = useLoad(() => api.audit(q), [tick, status, tool, from]);
  return (
    <section aria-labelledby="h-audit">
      <h1 id="h-audit">Historial y auditoria</h1>
      <div className={styles['form']}>
        <label>
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {['pending_approval', 'executed', 'denied', 'blocked', 'expired', 'failed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Herramienta
          <select value={tool} onChange={(e) => setTool(e.target.value)}>
            <option value="">Todas</option>
            {['get_order', 'issue_refund', 'send_customer_email'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      </div>
      <State
        loading={a.loading}
        error={a.error}
        empty={a.data?.requests.length === 0}
        emptyText="Sin registros para estos filtros."
      >
        <table className={styles['table']}>
          <caption className={styles['muted']}>Llamadas registradas, mas recientes primero</caption>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Herramienta</th>
              <th scope="col">Regla</th>
              <th scope="col">Resultado</th>
              <th scope="col">Responsable</th>
            </tr>
          </thead>
          <tbody>
            {a.data?.requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`#/action/${r.id}`}>{formatTime(r.requestedAt)}</a>
                </td>
                <td>{r.tool}</td>
                <td>{r.ruleId ?? 'sin regla'}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.approvedBy ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </State>
    </section>
  );
}

export function PolicyView() {
  const p = useLoad(() => api.policy(), []);
  const pol: PolicyDto | null = p.data?.policy ?? null;
  return (
    <section aria-labelledby="h-policy">
      <h1 id="h-policy">Politicas (solo lectura)</h1>
      <State loading={p.loading} error={p.error}>
        {p.data?.mode === 'blocked' && (
          <p role="alert" className={styles['bad']}>
            Modo bloqueado: {p.data.error}
          </p>
        )}
        {pol && (
          <>
            <p>
              Por defecto: <strong>{pol.defaultEffect}</strong> · Caducidad de aprobacion:{' '}
              {pol.approval.ttlSeconds} s
            </p>
            <table className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Regla</th>
                  <th scope="col">Herramienta</th>
                  <th scope="col">Efecto</th>
                  <th scope="col">Condiciones</th>
                </tr>
              </thead>
              <tbody>
                {pol.rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.id}
                      <div className={styles['muted']}>{r.reason}</div>
                    </td>
                    <td>
                      {r.upstream}/{r.tool}
                    </td>
                    <td>{r.effect}</td>
                    <td>
                      <span className={styles['code']}>{JSON.stringify(r.when)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </State>
    </section>
  );
}
