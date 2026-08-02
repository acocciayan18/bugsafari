import { useRef, useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function StateRaces() {
  const [items, setItems] = useState<string[]>([]);
  const [ready, setReady] = useState(true);
  const stale = useRef<any>(null);

  const startLoad = () => {
    setReady(false);
    stale.current = setTimeout(() => {
      const first: any = items[0];
      setItems([first.toUpperCase()]);
    }, 900);
  };

  const teardown = () => {
    setItems([]);
    setReady(true);
  };

  return (
    <ScenarioLayout slug="state-races">
      <div className="panel">
        <h2>Async teardown race</h2>
        <p className="summary">Start the load, then reset before it settles. The stale resolve reads emptied state and throws.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={startLoad} disabled={!ready}>Start load</button>
          <button onClick={teardown}>Reset now</button>
        </div>
        <div className="out">items: {JSON.stringify(items)} · ready: {String(ready)}</div>
      </div>
    </ScenarioLayout>
  );
}
