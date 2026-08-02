import ScenarioLayout from '../components/ScenarioLayout';

const triggers: { label: string; run: () => void }[] = [
  { label: 'Undefined property', run: () => { const o: any = undefined; return o.name; } },
  { label: 'Null property', run: () => { const el: any = document.querySelector('#missing-xyz'); return el.value; } },
  { label: 'Not iterable', run: () => { const users: any = 42; for (const u of users) console.log(u); } },
  { label: 'ReferenceError', run: () => { return (window as any).eval('handleSubmitMissing()'); } },
  { label: 'Not a function', run: () => { const onClose: any = 5; onClose(); } },
  { label: 'Stack overflow', run: () => { const rec = (): number => rec(); return rec(); } },
  { label: 'RangeError', run: () => { return new Array(-1); } },
  { label: 'SyntaxError (bad JSON)', run: () => { return JSON.parse('<not json>'); } },
  { label: 'Chunk load failure', run: () => { throw new Error('ChunkLoadError: Loading chunk 12 failed'); } },
  { label: 'Unhandled rejection', run: () => { void Promise.reject(new Error('silent fetch failed')); } }
];

export default function JsRuntimeErrors() {
  return (
    <ScenarioLayout slug="js-runtime-errors">
      <div className="panel">
        <h2>Throw a runtime fault</h2>
        <p className="summary">Each button throws (or rejects) uncaught, exactly as a real regression would.</p>
        <div className="row" style={{ marginTop: 12 }}>
          {triggers.map((t) => (
            <button key={t.label} className="danger" onClick={() => t.run()}>{t.label}</button>
          ))}
        </div>
      </div>
    </ScenarioLayout>
  );
}
