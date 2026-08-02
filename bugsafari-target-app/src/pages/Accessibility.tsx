import { useEffect } from 'react';
import ScenarioLayout from '../components/ScenarioLayout';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export default function Accessibility() {
  useEffect(() => {
    const prevTitle = document.title;
    const prevLang = document.documentElement.getAttribute('lang');
    document.title = '';
    document.documentElement.removeAttribute('lang');
    return () => {
      document.title = prevTitle;
      if (prevLang) document.documentElement.setAttribute('lang', prevLang);
    };
  }, []);

  return (
    <ScenarioLayout slug="accessibility">
      <div className="panel">
        <h2>Structural WCAG violations</h2>
        <p className="summary">One route with seven distinct violations for the read-only auditor. This route also strips &lt;html lang&gt; and the document title.</p>
        <div className="row" style={{ marginTop: 12, gap: 20 }}>
          <img src={PIXEL} width={40} height={40} />
          <input type="text" placeholder="unlabeled input" />
          <button aria-hidden="false"><span className="spinner" /></button>
          <a href="#" tabIndex={3} onClick={(e) => e.preventDefault()}>positive tabindex</a>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <span id="dup-node">duplicate id A</span>
          <span id="dup-node">duplicate id B</span>
        </div>
      </div>
    </ScenarioLayout>
  );
}
