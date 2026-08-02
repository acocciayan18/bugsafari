import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ScenarioLayout from '../components/ScenarioLayout';

export default function NavigationDefects() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const loop = params.get('loop');

  useEffect(() => {
    if (loop === 'a') { const t = setTimeout(() => navigate('/navigation-defects?loop=b'), 300); return () => clearTimeout(t); }
    if (loop === 'b') { const t = setTimeout(() => navigate('/navigation-defects?loop=a'), 300); return () => clearTimeout(t); }
  }, [loop, navigate]);

  return (
    <ScenarioLayout slug="navigation-defects">
      <div className="panel">
        <h2>Broken navigation</h2>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
          <a href="#" onClick={(e) => e.preventDefault()}>Dead link (no-op)</a>
          <a href="/reports/old">Broken route → server HTTP 404</a>
          <a href="/r1">HTTP redirect loop (/r1 → /r2 → /r1)</a>
          <a onClick={() => navigate('/navigation-defects?loop=a')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
            SPA redirect loop (client oscillation)
          </a>
        </div>
        {loop && <div className="out">oscillating on ?loop={loop}</div>}
      </div>
    </ScenarioLayout>
  );
}
