import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function ApiHang() {
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/hang').then(() => setLoading(false)).catch(() => setLoading(false));
  };

  return (
    <ScenarioLayout slug="api-hang">
      <div className="panel">
        <h2>Load profile</h2>
        <p className="summary">The request never resolves; the spinner stays forever with no error or retry.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={load} disabled={loading}>Load profile</button>
          {loading && (
            <span className="row" aria-busy="true" role="progressbar">
              <span className="spinner" /> Loading…
            </span>
          )}
        </div>
      </div>
    </ScenarioLayout>
  );
}
