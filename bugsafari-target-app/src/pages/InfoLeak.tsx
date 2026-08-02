import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function InfoLeak() {
  const [out, setOut] = useState('');

  const run = async () => {
    const r = await fetch('/api/error-leak');
    setOut(`HTTP ${r.status} — ${await r.text()}`);
  };

  return (
    <ScenarioLayout slug="info-leak">
      <div className="panel">
        <h2>Generate report</h2>
        <p className="summary">The failing endpoint returns a raw stack trace and a database connection string to the client.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={run}>Generate report</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
