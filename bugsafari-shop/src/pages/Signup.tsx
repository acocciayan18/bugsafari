import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) { setError('All fields are required.'); return; }
    if (!form.email.includes('@')) { setError('Enter a valid email.'); return; }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await signup(form.name, form.email, form.password);
      nav('/profile');
    } catch (err: any) {
      setError(err.message || 'Signup failed');
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <label>Full name<input value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>Email<input value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label>Password<input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} /></label>
        <label>Confirm password<input type="password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-lg" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
        <p className="muted">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
