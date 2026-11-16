import { useEffect, useState } from 'react';

export type StreamState = 'connecting' | 'live' | 'reconnecting';

/** SSE with a visible connection state. `tick` changes on every server event so views refetch. */
export function useEvents(enabled: boolean): { state: StreamState; tick: number } {
  const [state, setState] = useState<StreamState>('connecting');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/events');
    es.onopen = () => {
      setState('live');
      setTick((t) => t + 1);
    };
    es.onerror = () => setState('reconnecting');
    es.addEventListener('request', () => setTick((t) => t + 1));
    return () => es.close();
  }, [enabled]);
  return { state, tick };
}

/** Re-render every second so countdowns stay current. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  return now;
}
