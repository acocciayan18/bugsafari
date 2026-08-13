import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function StateRaces() {
  const [out, setOut] = useState('');
  const [value, setValue] = useState<number | null>(null);

  // Unguarded read-modify-write: overlapping clicks read the same base and write the same
  // value+1, so concurrent increments collide and one update is lost (SPA lost-update race).
  const increment = async () => {
    const cur = await fetch('/api/counter').then((r) => r.json());
    const r = await fetch('/api/counter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: cur.value + 1 }),
    });
    const fresh = await r.json();
    setValue(fresh.value);
    setOut((p) => `${p}\nPOST /api/counter {value:${cur.value + 1}} → HTTP ${r.status}, value=${fresh.value}`.trim());
  };

  // Guarded compare-and-set: the write carries the version it read, so a stale racer gets 409
  // instead of silently clobbering the winner.
  const safeIncrement = async () => {
    const cur = await fetch('/api/counter').then((r) => r.json());
    const r = await fetch('/api/counter/cas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: cur.value + 1, version: cur.version }),
    });
    const body = await r.json();
    if (r.status === 200) setValue(body.value);
    setOut((p) => `${p}\nPOST /api/counter/cas → HTTP ${r.status}`.trim());
  };

  return (
    <ScenarioLayout slug="state-races">
      <div className="panel">
        <h2>Lost-update state race</h2>
        <p className="summary">Read-modify-write with no guard. Fire the increment concurrently and overlapping writes collide, dropping an update.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={increment}>Increment (unguarded)</button>
          <button onClick={safeIncrement}>Increment (compare-and-set 409)</button>
        </div>
        <div className="out">{`value: ${value === null ? '—' : value}${out ? '\n' + out : ''}`}</div>
      </div>
    </ScenarioLayout>
  );
}
