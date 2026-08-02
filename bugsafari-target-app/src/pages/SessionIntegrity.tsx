import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ScenarioLayout from '../components/ScenarioLayout';

export default function SessionIntegrity() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');

  useEffect(() => {
    const t = 'session-' + 'abc123';
    localStorage.setItem('authToken', t);
    document.cookie = 'session=abc123; path=/';
    setToken(t);
  }, []);

  const save = () => {
    localStorage.removeItem('authToken');
    document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    navigate('/login');
  };

  return (
    <ScenarioLayout slug="session-integrity">
      <div className="panel">
        <h2>Settings (authenticated)</h2>
        <p className="summary">You are logged in. Saving settings silently drops the session and bounces you to /login.</p>
        <div className="out">authToken: {token || '(none)'}</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="danger" onClick={save}>Save settings</button>
        </div>
      </div>
    </ScenarioLayout>
  );
}
