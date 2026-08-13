import { useRef, useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function DuplicateActions() {
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useRef(`pay_${Date.now()}`);

  // fixed: synchronous ref guard + disabled button + idempotency key make double-submit a no-op
  const pay = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key.current },
        body: '{"amount":49}'
      });
      const body = await r.json();
      setOut((p) => `${p}\nPOST /api/checkout → HTTP ${r.status} (charge ${body.chargeId})`.trim());
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const guarded = async () => {
    const r = await fetch('/api/guarded', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"amount":49}' });
    setOut((p) => `${p}\nPOST /api/guarded → HTTP ${r.status}`.trim());
  };

  return (
    <ScenarioLayout slug="duplicate-actions">
      <div className="panel">
        <h2>Single submit</h2>
        <p className="summary">The button disables while in flight and sends a stable idempotency key, so repeat clicks resolve to one charge.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={pay} disabled={busy}>Pay now</button>
          <button onClick={guarded}>Pay now (server-guarded 409)</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
