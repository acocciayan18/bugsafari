import { Link } from 'react-router-dom';
import { CATEGORY_ORDER, SCENARIOS, type Category } from '../scenarios/registry';

export default function Home() {
  return (
    <div>
      <div className="scenario-head">
        <h1>Benchmark scenarios</h1>
        <p className="summary">
          Fixed counterpart of the target app. Every route keeps its original UI and flow, but the underlying
          defect is genuinely remediated. Point the engine at this app's public tunnel URL and no valid finding should be produced.
        </p>
      </div>
      {CATEGORY_ORDER.map((cat: Category) => {
        const items = SCENARIOS.filter((s) => s.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat}>
            <h2 className="cat-title">{cat}</h2>
            <div className="grid">
              {items.map((s) => (
                <Link key={s.slug} to={`/${s.slug}`} className="card">
                  <h3>{s.title}</h3>
                  <p>{s.summary}</p>
                  <div className="meta">
                    <span className={`tag sev-${s.expectedSeverity}`}>{s.expectedSeverity}</span>
                    <span className="tag">{s.cwe}</span>
                    {!s.detected && <span className="tag">NOT DETECTED</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
