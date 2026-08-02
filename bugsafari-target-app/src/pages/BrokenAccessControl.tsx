import { useEffect, useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function BrokenAccessControl() {
  const role = localStorage.getItem('role') || 'user';
  const isAdmin = role === 'admin';
  const [serverData, setServerData] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/admin', { headers: { 'x-role': role } })
      .then((r) => r.ok ? r.text() : Promise.reject(r.status))
      .then((t) => setServerData(t))
      .catch((s) => setServerData(`denied (${s})`));
  }, [isAdmin, role]);

  const forge = () => { localStorage.setItem('role', 'admin'); location.reload(); };
  const reset = () => { localStorage.removeItem('role'); location.reload(); };

  return (
    <ScenarioLayout slug="broken-access-control">
      <div className="panel">
        <h2>Account</h2>
        <p className="summary">
  User privileges are controlled by the client-side <code>localStorage.role</code> value. Altering it to <code>admin</code> unlocks the admin interface, and the server processes privileged requests without verifying the user's permissions.
</p>
        <div className="out">current role: {role}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={forge}>Forge role=admin</button>
          <button onClick={reset}>Reset</button>
        </div>
      </div>
      {isAdmin && (
        <div className="panel" data-admin-panel="true">
          <h2>🔓 Admin Console</h2>
          <p className="summary">
  Privileged controls are exposed because the application trusts the client-reported administrator role.
</p>
<div className="row"><button className="danger">Delete all users</button><button className="danger">Export secrets</button></div>
          {serverData && <div className="out">GET /api/admin → {serverData}</div>}
        </div>
      )}
    </ScenarioLayout>
  );
}
