import { useState } from 'react';

type SubsystemStatus = { status: 'ok' | 'error'; message?: string };
type HealthResponse = {
  status: 'ok' | 'degraded';
  subsystems: Record<string, SubsystemStatus>;
};

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkHealth() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/health');
      const data = (await res.json()) as HealthResponse;
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error reaching the API');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '40px auto', padding: '0 16px' }}>
      <h1>Findo</h1>
      <p>
        <em>Foundation shell (F1.1) — proves the web app can reach the API. Accounts, transactions, and the real
        dashboard land in later features.</em>
      </p>

      <button onClick={checkHealth} disabled={loading}>
        {loading ? 'Checking...' : 'Check API Health'}
      </button>

      {error && <p style={{ color: 'crimson' }}>Error reaching the API: {error}</p>}

      {health && (
        <div style={{ marginTop: 16 }}>
          <strong>Overall status: {health.status}</strong>
          <ul>
            {Object.entries(health.subsystems).map(([name, s]) => (
              <li key={name}>
                {name}: {s.status}
                {s.message ? ` — ${s.message}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
