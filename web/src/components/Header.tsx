import { useEffect, useState } from 'react';
import { StatusDot } from './ui/StatusDot';
import { Button } from './ui/Button';

type SubsystemStatus = { status: 'ok' | 'error'; message?: string };
type HealthResponse = {
  status: 'ok' | 'degraded';
  subsystems: Record<string, SubsystemStatus>;
};

export function Header() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

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

  useEffect(() => {
    checkHealth();
  }, []);

  const tone = error ? 'error' : health ? (health.status === 'ok' ? 'ok' : 'error') : 'unknown';
  const label = loading
    ? 'Checking API...'
    : error
      ? 'Unable to reach API'
      : health
        ? health.status === 'ok'
          ? 'All systems operational'
          : 'Degraded'
        : 'Unknown';

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-lg font-semibold tracking-tight text-stone-900">Findo</span>
          <span className="hidden text-sm text-stone-400 sm:inline">personal finance</span>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex items-center gap-2 rounded-full border border-stone-200 px-3 py-1 text-sm text-stone-600 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
          >
            <StatusDot tone={tone} />
            <span>{label}</span>
          </button>

          {detailsOpen && (
            <div className="absolute right-0 z-10 mt-2 w-72 rounded-lg border border-stone-200 bg-white p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
                  API health
                </span>
                <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={checkHealth} disabled={loading}>
                  {loading ? 'Checking...' : 'Refresh'}
                </Button>
              </div>

              {error && <p className="text-sm text-rose-600">Error reaching the API: {error}</p>}

              {health && (
                <ul className="space-y-1">
                  {Object.entries(health.subsystems).map(([name, s]) => (
                    <li key={name} className="flex items-center gap-2 text-sm text-stone-700">
                      <StatusDot tone={s.status === 'ok' ? 'ok' : 'error'} />
                      <span className="font-medium">{name}</span>
                      <span className="text-stone-400">{s.status}</span>
                      {s.message && <span className="text-stone-400">— {s.message}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
