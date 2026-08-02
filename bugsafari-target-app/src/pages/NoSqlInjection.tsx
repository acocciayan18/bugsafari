import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function NoSqlInjection() {
  const [out, setOut] = useState('');
  const [raw, setRaw] = useState('{"$ne":null}');

  const login = async () => {
    let username: unknown = raw;
    try { username = JSON.parse(raw); } catch { /* send as string */ }
    const r = await fetch('/api/login-nosql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'x' }) });
    setOut(`HTTP ${r.status} — ${await r.text()}`);
  };

  return (
    <ScenarioLayout slug="nosql-injection">
      <div className="panel">
        <h2>NoSQL login</h2>
        <p className="summary">A benign string 401s. The operator object bypasses auth at 200; a bad operator leaks a MongoError.</p>
        <label>Username payload (JSON or string)</label>
        <input value={raw} onChange={(e) => setRaw(e.target.value)} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={login}>Login</button>
          <button onClick={() => setRaw('alice')}>Use benign value</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
