import { useState, type FormEvent } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function NoSqlInjectionFirestore() {
  const [out, setOut] = useState('');
  const [raw, setRaw] = useState('{"$ne":null}');

  const login = async (e: FormEvent) => {
    e.preventDefault();
    let username: unknown = raw;
    try { username = JSON.parse(raw); } catch { /* send as string */ }
    const r = await fetch('/api/login-nosql-firestore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'x' }),
    });
    setOut(`HTTP ${r.status} — ${await r.text()}`);
  };

  return (
    <ScenarioLayout slug="nosql-injection-firestore">
      <div className="panel">
        <h2>Firestore NoSQL login</h2>
        <p className="summary">Benign usernames query Firestore and 401. An operator object bypasses auth at 200; a bad operator leaks a MongoError.</p>
        <form onSubmit={login}>
          <label htmlFor="username">Username payload (JSON or string)</label>
          <input id="username" name="username" value={raw} onChange={(e) => setRaw(e.target.value)} />
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" className="danger">Login</button>
            <button type="button" onClick={() => setRaw('alice')}>Use benign value</button>
          </div>
        </form>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
