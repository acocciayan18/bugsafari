import { useState } from 'react';
import ScenarioLayout from '../../components/ScenarioLayout';

export default function CascadingNetwork() {
  const [out, setOut] = useState('');

  const burst = async () => {
    setOut('firing 6 failing requests in <2s …');
    const calls = Array.from({ length: 6 }, () => fetch('/api/drop').catch(() => null));
    await Promise.all(calls);
    setOut('burst complete — engine throttles back-off but emits no finding');
  };

  return (
    <ScenarioLayout slug="future/cascading-network">
      <div className="banner warn">
        Documented in BUG_TYPES.md; the burst window drives NetworkFailureCascadeTracker throttling only — no CASCADING_STATE_FAILURE finding is emitted.
      </div>
      <div className="panel">
        <h2>Failure burst</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={burst}>Fire 6 failing requests</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
