import { useEffect, useState } from 'react';
import { api, setCsrf } from './api';
import styles from './app.module.css';
import { Audit, Detail, Home, Inbox, Login, PolicyView } from './screens';
import { useEvents } from './useEvents';

function useHash(): string {
  const [h, setH] = useState(window.location.hash || '#/');
  useEffect(() => {
    const f = () => setH(window.location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [demo, setDemo] = useState(false);
  const hash = useHash();
  const { state, tick } = useEvents(auth === 'in');

  const check = () =>
    api
      .getSession()
      .then((s) => {
        setCsrf(s.csrfToken);
        setDemo(s.demoMode);
        setAuth('in');
      })
      .catch(() => setAuth('out'));
  useEffect(() => {
    void check();
  }, []);

  if (auth === 'checking')
    return (
      <div className={styles['app']}>
        <p role="status">Cargando...</p>
      </div>
    );
  if (auth === 'out')
    return (
      <div className={styles['app']}>
        <Login onDone={() => void check()} />
      </div>
    );

  const route = hash.replace(/^#/, '');
  const detail = /^\/action\/([0-9a-f]{10})$/.exec(route);
  const link = (to: string, label: string) => (
    <a href={`#${to}`} aria-current={route === to ? 'page' : undefined}>
      {label}
    </a>
  );

  return (
    <div className={styles['app']}>
      {state === 'reconnecting' && (
        <div className={styles['banner']} role="status">
          Conexion en vivo perdida. Reintentando... los datos pueden estar desactualizados.
        </div>
      )}
      <header className={styles['header']}>
        <span className={styles['brand']}>MCP Guard</span>
        <nav className={styles['nav']} aria-label="Principal">
          {link('/', 'Inicio')}
          {link('/inbox', 'Bandeja')}
          {link('/audit', 'Historial')}
          {link('/policy', 'Politicas')}
        </nav>
        <span className={styles['muted']}>{state === 'live' ? 'En vivo' : 'Conectando'}</span>
        <button
          className={styles['btn']}
          onClick={() => {
            api.logout().finally(() => setAuth('out'));
          }}
        >
          Salir
        </button>
      </header>
      <main className={styles['main']}>
        {detail?.[1] ? (
          <Detail id={detail[1]} tick={tick} />
        ) : route === '/inbox' ? (
          <Inbox tick={tick} />
        ) : route === '/audit' ? (
          <Audit tick={tick} />
        ) : route === '/policy' ? (
          <PolicyView />
        ) : (
          <Home tick={tick} demoMode={demo} />
        )}
      </main>
    </div>
  );
}
