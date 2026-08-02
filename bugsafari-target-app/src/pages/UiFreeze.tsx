import ScenarioLayout from '../components/ScenarioLayout';

export default function UiFreeze() {
  const freeze = () => {
    const end = performance.now() + 9000;
    let x = 0;
    while (performance.now() < end) { x += Math.sqrt(x + 1); }
    console.log('unblocked', x);
  };

  return (
    <ScenarioLayout slug="ui-freeze">
      <div className="panel">
        <h2>Freeze the main thread</h2>
        <p className="summary">A synchronous 9s loop blocks the event loop well past the 5s heartbeat timeout.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={freeze}>Freeze UI (9s)</button>
        </div>
      </div>
    </ScenarioLayout>
  );
}
