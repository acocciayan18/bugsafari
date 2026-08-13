import { useState } from 'react';
import ScenarioLayout from '../../components/ScenarioLayout';

export default function CascadingNetwork() {
  const [out, setOut] = useState('');

  // fixed: requests succeed and are awaited safely; no failure cascade
  const burst = async () => {
    setOut('firing 6 requests …');
    const calls = Array.from({ length: 6 }, () => fetch('/api/drop').then((r) => r.ok).catch(() => false));
    const ok = (await Promise.all(calls)).filter(Boolean).length;
    setOut(`burst complete — ${ok}/6 succeeded, no cascade`);
  };

  return (
    <ScenarioLayout slug="future/cascading-network">
      <div className="panel">
        <h2>Request burst</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={burst}>Fire 6 requests</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
