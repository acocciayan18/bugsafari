import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function ConstraintBypass() {
  const [out, setOut] = useState('');

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = { username: (form.elements.namedItem('username') as HTMLInputElement).value, bio: (form.elements.namedItem('bio') as HTMLTextAreaElement).value };
    const r = await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    // fixed: server re-validates, so a stripped-DOM submit is rejected with 400
    setOut(r.ok ? `HTTP ${r.status} — saved` : `HTTP ${r.status} — rejected: ${(data.errors || []).join(', ')}`);
  };

  return (
    <ScenarioLayout slug="constraint-bypass">
      <div className="panel">
        <h2>Validated profile</h2>
        <p className="summary">required / maxlength are enforced in the DOM and re-checked on the server, so stripping them in devtools no longer succeeds.</p>
        <form onSubmit={submit}>
          <label>Username (required, maxlength 8)</label>
          <input name="username" required maxLength={8} defaultValue="" />
          <label>Bio</label>
          <textarea name="bio" required maxLength={20} defaultValue="" />
          <div className="row" style={{ marginTop: 14 }}>
            <button type="submit">Save profile</button>
          </div>
        </form>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
