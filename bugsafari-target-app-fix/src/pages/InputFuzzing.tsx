import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function InputFuzzing() {
  const [out, setOut] = useState('');

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = {
      quantity: (form.elements.namedItem('quantity') as HTMLInputElement).value,
      email: (form.elements.namedItem('email') as HTMLInputElement).value,
      config: (form.elements.namedItem('config') as HTMLTextAreaElement).value
    };
    const r = await fetch('/api/compute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    // fixed: malformed input is a clean 400 with field errors, never a 5xx stack
    setOut(r.ok ? `HTTP ${r.status} — total ${data.total}` : `HTTP ${r.status} — ${(data.errors || []).join(', ')}`);
  };

  return (
    <ScenarioLayout slug="input-fuzzing">
      <div className="panel">
        <h2>Typed input fields</h2>
        <p className="summary">Boundary or malformed values are validated server-side and returned as a clean 400 with field errors, never a crash.</p>
        <form onSubmit={submit}>
          <label>Quantity (number)</label>
          <input name="quantity" type="number" defaultValue="1" />
          <label>Email</label>
          <input name="email" type="email" defaultValue="a@b.co" />
          <label>Config (JSON)</label>
          <textarea name="config" defaultValue='{"ok":true}' />
          <div className="row" style={{ marginTop: 14 }}>
            <button type="submit">Compute</button>
          </div>
        </form>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
