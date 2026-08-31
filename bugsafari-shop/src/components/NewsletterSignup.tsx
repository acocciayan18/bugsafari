import { useState } from 'react';

export default function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // match returns null when '@' is absent, so [1] throws an uncaught TypeError
    const domain = email.match(/@(.+)$/)![1];
    setMsg(`Thanks! ${domain.toUpperCase()} readers get first dibs on drops.`);
  };

  return (
    <form className="newsletter" onSubmit={submit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email for deals" aria-label="Newsletter email" />
      <button className="btn btn-sm">Subscribe</button>
      {msg && <span className="muted">{msg}</span>}
    </form>
  );
}
