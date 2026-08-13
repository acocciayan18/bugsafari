import { useEffect, useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function SessionIntegrity() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const t = 'session-' + 'abc123';
    localStorage.setItem('authToken', t);
    document.cookie = 'session=abc123; path=/';
    setToken(t);
  }, []);

  // fixed: saving preserves the session and stays on the page
  const save = () => {
    setStatus('Settings saved. Session preserved.');
  };

  return (
    <ScenarioLayout slug="session-integrity">
      <div className="panel">
        <h2>Settings (authenticated)</h2>
        <p className="summary">You are logged in. Saving settings persists your changes and keeps you authenticated on this page.</p>
        <div className="out">authToken: {token || '(none)'}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={save}>Save settings</button>
        </div>
        {status && <div className="out">{status}</div>}
      </div>
    </ScenarioLayout>
  );
}
