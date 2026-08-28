import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

interface TrackInfo { orderNumber: string; status: string; steps: string[]; currentStep: number; total: number; }

export default function Track() {
  const { orderNumber } = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState(orderNumber || '');
  const [info, setInfo] = useState<TrackInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const lookup = (num: string) => {
    if (!num) return;
    setLoading(true);
    setError('');
    setInfo(null);
    api<TrackInfo>(`/orders/track/${num}`)
      .then(setInfo)
      .catch(() => setError('We could not find an order with that number.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (orderNumber) lookup(orderNumber); }, [orderNumber]);

  const submit = (e: React.FormEvent) => { e.preventDefault(); nav(`/track/${code.trim()}`); };

  return (
    <div className="track">
      <h1>Track your order</h1>
      <form className="track-form" onSubmit={submit}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. NB-1001" aria-label="Order number" />
        <button className="btn">Track</button>
      </form>

      {loading && <div className="loader"><span className="spinner" /> Looking up…</div>}
      {error && <p className="error">{error}</p>}

      {info && (
        <div className="track-result">
          <div className="track-head">
            <span className="order-no">{info.orderNumber}</span>
            <span className="pill">{info.status}</span>
          </div>
          <ol className="steps">
            {info.steps.map((s, i) => (
              <li key={s} className={i <= info.currentStep ? 'done' : ''}>
                <span className="dot" />{s}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
