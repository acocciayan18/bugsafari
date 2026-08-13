import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function XssInjection() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('<img src=x onerror=alert(1)>');

  const search = async () => {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    // fixed: render as text via React (auto-escaped); server also HTML-escapes the echo
    setText(data.resultText);
  };

  return (
    <ScenarioLayout slug="xss-injection">
      <div className="panel">
        <h2>Reflected search</h2>
        <p className="summary">The query is rendered as text, not HTML, so injected markup is displayed literally and never executes.</p>
        <label>Search</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={search}>Search</button>
        </div>
        {text && <div className="out">{text}</div>}
      </div>
    </ScenarioLayout>
  );
}
