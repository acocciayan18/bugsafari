import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function SqlInjection() {
  const [out, setOut] = useState('');
  const [username, setUsername] = useState("' OR '1'='1");

  const login = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'x' }) });
    setOut(`HTTP ${r.status} — ${await r.text()}`);
  };

  return (
    <ScenarioLayout slug="sql-injection">
      <div className="panel">
        <h2>SQL login</h2>
        <p className="summary">Benign credentials return 401. The tautology widens the query to a 200; a malformed quote leaks a driver error.</p>
        <form onSubmit={login}>
          <label htmlFor="sql-username">Username</label>
          <input id="sql-username" name="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" className="danger">Login</button>
            <button type="button" onClick={() => setUsername('alice')}>Use benign value</button>
          </div>
        </form>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
