import { useState } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

export default function XssInjection() {
  const [html, setHtml] = useState('');
  const [q, setQ] = useState('<img src=x onerror=alert(1)>');

  const search = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    setHtml(data.resultHtml);
  };

  return (
    <ScenarioLayout slug="xss-injection">
      <div className="panel">
        <h2>Reflected search</h2>
        <p className="summary">The server echoes the query raw; the SPA renders it as HTML, so injected markup executes.</p>
        <form onSubmit={search}>
          <label htmlFor="xss-q">Search</label>
          <input id="xss-q" name="q" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" className="danger">Search</button>
          </div>
        </form>
        {html && <div className="out" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </ScenarioLayout>
  );
}
