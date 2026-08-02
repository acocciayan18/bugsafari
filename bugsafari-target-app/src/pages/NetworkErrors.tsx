import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function NetworkErrors() {
  const [out, setOut] = useState('');

  const serverError = async () => {
    setOut('POST /api/orders …');
    const r = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"qty":9999}' });
    setOut(`HTTP ${r.status} — ${await r.text()}`);
  };

  const softFail = async () => {
    setOut('GET /api/soft-fail …');
    const r = await fetch('/api/soft-fail');
    setOut(`HTTP ${r.status} (masked) — ${await r.text()}`);
  };

  const transport = async () => {
    setOut('GET /api/drop …');
    try {
      await fetch('/api/drop');
      setOut('unexpected response');
    } catch (e) {
      setOut(`transport failure — ${String(e)}`);
    }
  };

  return (
    <ScenarioLayout slug="network-errors">
      <div className="panel">
        <h2>Backend failures</h2>
        <div className="row">
          <button className="danger" onClick={serverError}>Place order (500)</button>
          <button className="danger" onClick={softFail}>Soft-fail 200 body</button>
          <button className="danger" onClick={transport}>Dropped connection</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
