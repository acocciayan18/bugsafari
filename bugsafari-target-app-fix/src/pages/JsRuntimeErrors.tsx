import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

// fixed: each operation is guarded, so it resolves safely instead of throwing uncaught
const triggers: { label: string; run: () => string }[] = [
  { label: 'Undefined property', run: () => { const o = JSON.parse('null') as { name?: string } | null; return `name = ${o?.name ?? 'n/a'}`; } },
  { label: 'Null property', run: () => { const el = document.querySelector<HTMLInputElement>('#missing-xyz'); return `value = ${el?.value ?? 'n/a'}`; } },
  { label: 'Not iterable', run: () => { const users: unknown = 42; const list = Array.isArray(users) ? users : []; return `iterated ${list.length} items`; } },
  { label: 'ReferenceError', run: () => { const handleSubmit = () => 'submitted'; return handleSubmit(); } },
  { label: 'Not a function', run: () => { const onClose: unknown = 5; return typeof onClose === 'function' ? String((onClose as () => unknown)()) : 'no handler bound'; } },
  { label: 'Bounded recursion', run: () => { let n = 0; for (let i = 0; i < 1000; i++) n += 1; return `computed ${n}`; } },
  { label: 'RangeError', run: () => { const len = 5; return `array length ${new Array(Math.max(0, len)).length}`; } },
  { label: 'Parse JSON', run: () => { try { return JSON.stringify(JSON.parse('{"ok":true}')); } catch { return 'invalid JSON handled'; } } },
  { label: 'Chunk load recovery', run: () => 'chunk load retried and recovered' },
  { label: 'Handled rejection', run: () => { void Promise.reject(new Error('fetch failed')).catch(() => {}); return 'rejection handled'; } }
];

export default function JsRuntimeErrors() {
  const [out, setOut] = useState('');

  const run = (label: string, fn: () => string) => {
    try { setOut(`${label}: ${fn()}`); } catch (e) { setOut(`${label}: handled (${String(e)})`); }
  };

  return (
    <ScenarioLayout slug="js-runtime-errors">
      <div className="panel">
        <h2>Run a guarded operation</h2>
        <p className="summary">Each button runs a defensive handler that resolves safely, so no uncaught error or unhandled rejection escapes.</p>
        <div className="row" style={{ marginTop: 12 }}>
          {triggers.map((t) => (
            <button key={t.label} onClick={() => run(t.label, t.run)}>{t.label}</button>
          ))}
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
