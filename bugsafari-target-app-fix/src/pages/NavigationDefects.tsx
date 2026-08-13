import { useNavigate, useSearchParams } from 'react-router-dom';
import ScenarioLayout from '../components/ScenarioLayout';

export default function NavigationDefects() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const step = params.get('step');

  return (
    <ScenarioLayout slug="navigation-defects">
      <div className="panel">
        <h2>Navigation</h2>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
          {/* fixed: performs a real in-app navigation instead of a dead no-op */}
          <a onClick={() => navigate('/')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>Home (works)</a>
          {/* fixed: points at a resolvable route (301 -> /reports/latest, HTTP 200) */}
          <a href="/reports/latest">Reports (resolves, HTTP 200)</a>
          {/* fixed: chain terminates at /r2 instead of looping */}
          <a href="/r1">Redirect chain (/r1 then /r2, terminates)</a>
          {/* fixed: single settled navigation, no client oscillation */}
          <a onClick={() => navigate('/navigation-defects?step=done')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
            SPA navigation (settles)
          </a>
        </div>
        {step && <div className="out">navigated to step={step} (stable)</div>}
      </div>
    </ScenarioLayout>
  );
}
