import { useState } from 'react';

export default function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // guard the parse: no '@' shows a message instead of throwing
    const match = email.match(/@(.+)$/);
    if (!match) { setMsg('Please enter a valid email address.'); return; }
    setMsg(`Thanks! ${match[1].toUpperCase()} readers get first dibs on drops.`);
  };

  return (
    <form className="newsletter" onSubmit={submit}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email for deals" aria-label="Newsletter email" />
      <button className="btn btn-sm">Subscribe</button>
      {msg && <span className="muted">{msg}</span>}
    </form>
  );
}
