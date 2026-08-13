import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function NetworkErrors() {
  const [out, setOut] = useState('');

  // fixed: real 2xx, checked with r.ok and a guarded body parse
  const placeOrder = async () => {
    setOut('POST /api/orders …');
    try {
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"qty":3}' });
      const body = await r.json();
      setOut(r.ok ? `HTTP ${r.status} — order ${body.orderId}` : `HTTP ${r.status} — ${body.error}`);
    } catch (e) { setOut(`request failed, retry available — ${String(e)}`); }
  };

  // fixed: the 200 body is a genuine success, and we still verify body.ok
  const checkStatus = async () => {
    setOut('GET /api/soft-fail …');
    try {
      const r = await fetch('/api/soft-fail');
      const body = await r.json();
      setOut(r.ok && body.ok ? `HTTP ${r.status} — ${body.data.status}` : `HTTP ${r.status} — degraded`);
    } catch (e) { setOut(`request failed — ${String(e)}`); }
  };

  // fixed: connection completes; transport errors would still be caught
  const fetchData = async () => {
    setOut('GET /api/drop …');
    try {
      const r = await fetch('/api/drop');
      setOut(`HTTP ${r.status} — ${await r.text()}`);
    } catch (e) { setOut(`transport failure handled — ${String(e)}`); }
  };

  return (
    <ScenarioLayout slug="network-errors">
      <div className="panel">
        <h2>Backend calls</h2>
        <div className="row">
          <button onClick={placeOrder}>Place order</button>
          <button onClick={checkStatus}>Check status</button>
          <button onClick={fetchData}>Fetch data</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
