import { useSearchParams } from 'react-router-dom';
import ScenarioLayout from '../../components/ScenarioLayout';

export default function RouteMutation() {
  const [params, setParams] = useSearchParams();
  // fixed: invalid/undefined page values normalize to page 1 instead of white-screening
  const raw = params.get('page');
  const page = Number.isInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : 1;

  return (
    <ScenarioLayout slug="future/route-mutation">
      <div className="panel">
        <h2>Query-driven view</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => setParams({ page: '1' })}>Load page 1</button>
          <button onClick={() => setParams({ page: 'undefined' })}>Send malformed ?page</button>
        </div>
        <div className="out">resolved page: {page}{raw && !Number.isInteger(Number(raw)) ? ` (normalized from "${raw}")` : ''}</div>
      </div>
    </ScenarioLayout>
  );
}
