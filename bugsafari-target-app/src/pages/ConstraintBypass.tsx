import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function ConstraintBypass() {
  const [out, setOut] = useState('');

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = { username: (form.elements.namedItem('username') as HTMLInputElement).value, bio: (form.elements.namedItem('bio') as HTMLTextAreaElement).value };
    const r = await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    setOut(`HTTP ${r.status} — server accepted without re-validating (${await r.text()})`);
  };

  return (
    <ScenarioLayout slug="constraint-bypass">
      <div className="panel">
        <h2>Client-only validation</h2>
        <p className="summary">required / maxlength / disabled live only in the DOM. Strip them in devtools and submit — the server still accepts.</p>
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
