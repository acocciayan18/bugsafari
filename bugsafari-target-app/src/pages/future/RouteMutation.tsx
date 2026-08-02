import { useSearchParams } from 'react-router-dom';
import ScenarioLayout from '../../components/ScenarioLayout';

export default function RouteMutation() {
  const [params, setParams] = useSearchParams();
  const page = params.get('page');
  const broken = page === 'undefined';

  return (
    <ScenarioLayout slug="future/route-mutation">
      <div className="banner warn">
        Documented in BUG_TYPES.md; not detected — RouteTrasher is disabled engine-wide, so no ROUTE_TRASH transaction opens.
      </div>
      <div className="panel">
        <h2>Query-driven view</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => setParams({ page: '1' })}>Load page 1</button>
          <button className="danger" onClick={() => setParams({ page: 'undefined' })}>Mutate ?page=undefined</button>
        </div>
        {broken ? <div className="out">resolution broke — view white-screened</div> : <div className="out">page: {page || '(none)'}</div>}
      </div>
    </ScenarioLayout>
  );
}
