import { useEffect, useRef, useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function StateRaces() {
  const [items, setItems] = useState<string[]>([]);
  const [ready, setReady] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // fixed: any pending async write is cancelled on unmount
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const startLoad = () => {
    setReady(false);
    timer.current = setTimeout(() => {
      // fixed: guard against emptied/torn-down state instead of reading items[0] blindly
      setItems((prev) => (prev.length ? [prev[0].toUpperCase()] : ['LOADED']));
      setReady(true);
      timer.current = null;
    }, 900);
  };

  const teardown = () => {
    // fixed: cancel the in-flight load so no stale resolve lands after reset
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setItems([]);
    setReady(true);
  };

  return (
    <ScenarioLayout slug="state-races">
      <div className="panel">
        <h2>Async teardown race</h2>
        <p className="summary">Start the load, then reset. The reset cancels the pending timer, so no stale resolve writes into gone state.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={startLoad} disabled={!ready}>Start load</button>
          <button onClick={teardown}>Reset now</button>
        </div>
        <div className="out">items: {JSON.stringify(items)} · ready: {String(ready)}</div>
      </div>
    </ScenarioLayout>
  );
}
