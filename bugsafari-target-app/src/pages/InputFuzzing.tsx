import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function InputFuzzing() {
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return; // disable-on-submit guard: one in-flight compute at a time
    setBusy(true);
    const form = e.currentTarget;
    const body = {
      quantity: (form.elements.namedItem('quantity') as HTMLInputElement).value,
      email: (form.elements.namedItem('email') as HTMLInputElement).value,
      config: (form.elements.namedItem('config') as HTMLTextAreaElement).value
    };
    try {
      const r = await fetch('/api/compute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      setOut(`HTTP ${r.status} — ${await r.text()}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScenarioLayout slug="input-fuzzing">
      <div className="panel">
        <h2>Typed input fields</h2>
        <p className="summary">Boundary or malformed values (negative quantity, bad email, non-JSON config) destabilize the backend into a 5xx.</p>
        <form onSubmit={submit}>
          <label>Quantity (number)</label>
          <input name="quantity" type="number" defaultValue="1" />
          <label>Email</label>
          <input name="email" type="email" defaultValue="a@b.co" />
          <label>Config (JSON)</label>
          <textarea name="config" defaultValue='{"ok":true}' />
          <div className="row" style={{ marginTop: 14 }}>
            <button type="submit" disabled={busy}>Compute</button>
          </div>
        </form>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
