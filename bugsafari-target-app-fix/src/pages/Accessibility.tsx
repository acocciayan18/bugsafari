import ScenarioLayout from '../components/ScenarioLayout';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// fixed: an accessible, WCAG-conformant route (no lang/title stripping, all controls named/labeled)
export default function Accessibility() {
  return (
    <ScenarioLayout slug="accessibility">
      <div className="panel">
        <h2>Accessible controls</h2>
        <p className="summary">Every control has an accessible name, images have alt text, ids are unique, tab order is natural, and the document keeps its title and lang.</p>
        <div className="row" style={{ marginTop: 12, gap: 20 }}>
          <img src={PIXEL} width={40} height={40} alt="Status indicator" />
          <label>
            Search
            <input type="text" placeholder="search" aria-label="Search" />
          </label>
          <button type="button" aria-label="Loading status"><span className="spinner" /></button>
          <a href="#section" onClick={(e) => e.preventDefault()}>In-page link</a>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <span id="node-a">node A</span>
          <span id="node-b">node B</span>
        </div>
      </div>
    </ScenarioLayout>
  );
}
