import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function ApiHang() {
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState('');

  // fixed: request resolves; an abort timeout guarantees the spinner always clears
  const load = async () => {
    setLoading(true);
    setOut('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch('/api/hang', { signal: ctrl.signal });
      const body = await r.json();
      setOut(`loaded: ${body.profile.name} (${body.profile.plan})`);
    } catch {
      setOut('request timed out, please retry');
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  return (
    <ScenarioLayout slug="api-hang">
      <div className="panel">
        <h2>Load profile</h2>
        <p className="summary">The request resolves promptly; if it ever stalled, an 8s abort clears the spinner and surfaces a retry.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={load} disabled={loading}>Load profile</button>
          {loading && (
            <span className="row" aria-busy="true" role="progressbar">
              <span className="spinner" /> Loading…
            </span>
          )}
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
