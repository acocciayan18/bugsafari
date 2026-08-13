import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

export default function UiFreeze() {
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState('');

  // fixed: the heavy loop is chunked and yields each slice, so the main thread stays responsive
  const compute = async () => {
    setRunning(true);
    let x = 0;
    const chunks = 60;
    for (let c = 0; c < chunks; c++) {
      const end = performance.now() + 8;
      while (performance.now() < end) x += Math.sqrt(x + 1);
      setOut(`working… ${Math.round(((c + 1) / chunks) * 100)}%`);
      await yieldToLoop();
    }
    setOut(`done (${x.toFixed(0)})`);
    setRunning(false);
  };

  return (
    <ScenarioLayout slug="ui-freeze">
      <div className="panel">
        <h2>Heavy computation</h2>
        <p className="summary">The work runs in short slices that yield to the event loop, so the heartbeat never misses and the UI stays interactive.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={compute} disabled={running}>Run computation</button>
        </div>
        {out && <div className="out">{out}</div>}
      </div>
    </ScenarioLayout>
  );
}
