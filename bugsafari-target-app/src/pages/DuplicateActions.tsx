import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function DuplicateActions() {
  const [out, setOut] = useState('');

  const pay = async () => {
    const r = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"amount":49}' });
    setOut((p) => `${p}\nPOST /api/checkout → HTTP ${r.status}`.trim());
  };

  const guarded = async () => {
    const r = await fetch('/api/guarded', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"amount":49}' });
    setOut((p) => `${p}\nPOST /api/guarded → HTTP ${r.status}`.trim());
  };

  return (
    <ScenarioLayout slug="duplicate-actions">
      <div className="panel">
        <h2>Double submit</h2>
        <p className="summary">No debounce, no disable-on-submit. Double-click to fire identical state-changing requests.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={pay}>Pay now (unguarded)</button>
          <button onClick={guarded}>Pay now (server-guarded 409)</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
