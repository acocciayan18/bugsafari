import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function SqlInjection() {
  const [out, setOut] = useState('');
  const [username, setUsername] = useState("' OR '1'='1");

  const login = async () => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'x' }) });
    setOut(`HTTP ${r.status} — ${await r.text()}`);
  };

  return (
    <ScenarioLayout slug="sql-injection">
      <div className="panel">
        <h2>SQL login</h2>
        <p className="summary">Credentials are compared as parameterized literals. The tautology and a stray quote both return a plain 401 with no data widening or driver-error leak.</p>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={login}>Login</button>
          <button onClick={() => setUsername('alice')}>Use benign value</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
