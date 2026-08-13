import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function InfoLeak() {
  const [out, setOut] = useState('');

  const run = async () => {
    const r = await fetch('/api/error-leak');
    const data = await r.json();
    // fixed: response carries a clean report, no stack trace or connection string
    setOut(r.ok ? `HTTP ${r.status} — report ${data.report.id} (${data.report.rows} rows)` : `HTTP ${r.status} — report unavailable`);
  };

  return (
    <ScenarioLayout slug="info-leak">
      <div className="panel">
        <h2>Generate report</h2>
        <p className="summary">The endpoint returns a sanitized result; internal stack traces and connection strings are never exposed to the client.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={run}>Generate report</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
