import { useEffect, useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function BrokenAccessControl() {
  const [role, setRole] = useState('user');
  const [serverData, setServerData] = useState('');

  // fixed: the authoritative role comes from the server session, not client storage
  const refresh = () => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => setRole(d.role))
      .catch(() => setRole('user'));
  };
  useEffect(refresh, []);

  const isAdmin = role === 'admin';

  useEffect(() => {
    if (!isAdmin) { setServerData(''); return; }
    fetch('/api/admin')
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then(setServerData)
      .catch((s) => setServerData(`denied (${s})`));
  }, [isAdmin]);

  // tampering client storage no longer changes the server-derived role
  const forge = () => { localStorage.setItem('role', 'admin'); refresh(); };
  const reset = () => { localStorage.removeItem('role'); refresh(); };

  return (
    <ScenarioLayout slug="broken-access-control">
      <div className="panel">
        <h2>Account</h2>
        <p className="summary">
          Privileges are resolved from a server-signed session. Editing <code>localStorage.role</code> is ignored, and the server authorizes <code>/api/admin</code> against the session, not any client-reported role.
        </p>
        <div className="out">current role: {role} (server-verified)</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={forge}>Attempt role=admin via storage</button>
          <button onClick={reset}>Reset</button>
        </div>
      </div>
      {isAdmin && (
        <div className="panel" data-admin-panel="true">
          <h2>🔓 Admin Console</h2>
          <p className="summary">Only shown for a genuine server-authorized admin session.</p>
          {serverData && <div className="out">GET /api/admin → {serverData}</div>}
        </div>
      )}
    </ScenarioLayout>
  );
}
