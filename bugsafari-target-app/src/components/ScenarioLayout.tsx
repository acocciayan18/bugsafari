import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SCENARIOS } from '../scenarios/registry';

export default function ScenarioLayout({ slug, children }: { slug: string; children: ReactNode }) {
  const s = SCENARIOS.find((x) => x.slug === slug);
  if (!s) return <div>Unknown scenario</div>;
  return (
    <div>
      <Link to="/" className="back">← all scenarios</Link>
      <div className="scenario-head">
        <h1>{s.title}</h1>
        <p className="summary">{s.summary}</p>
        <div className="meta" style={{ marginTop: 12 }}>
          <span className={`tag sev-${s.expectedSeverity}`}>{s.expectedSeverity}</span>
          <span className="tag">{s.bugClass}</span>
          <span className="tag">{s.cwe}</span>
          {!s.detected && <span className="tag">NOT DETECTED</span>}
        </div>
      </div>
      {children}
      <div className="panel">
        <h2>Expected finding</h2>
        <dl className="expected">
          <dt>Bug class</dt><dd>{s.bugClass}</dd>
          <dt>Detector</dt><dd>{s.detector}</dd>
          <dt>Severity</dt><dd>{s.expectedSeverity}</dd>
          <dt>Reproduction</dt><dd>{s.reproduction}</dd>
        </dl>
      </div>
    </div>
  );
}
