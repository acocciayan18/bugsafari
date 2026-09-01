import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

// TEMPORARY presentation/demo lock. NOT a security mechanism: the password lives in the
// client bundle and only gates the UI shell. Remove before any real deployment.
const DEMO_PASSWORD = 'Bugsafari_2026';
const UNLOCK_KEY = 'bugsafari_demo_unlocked';

function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export default function DemoAccessGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value === DEMO_PASSWORD) {
      try {
        sessionStorage.setItem(UNLOCK_KEY, '1');
      } catch {
        // Session storage unavailable — still unlock for this page load.
      }
      setUnlocked(true);
      return;
    }
    setError(true);
    setValue('');
  };

  return (
    <div style={styles.overlay}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={styles.badge}>Temporary demo access</div>
        <h1 style={styles.title}>BugSafari is locked</h1>
        <p style={styles.subtitle}>Enter the demo password to continue.</p>

        <input
          type="password"
          value={value}
          autoFocus
          placeholder="Demo password"
          aria-label="Demo password"
          aria-invalid={error}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
          style={{ ...styles.input, ...(error ? styles.inputError : null) }}
        />

        {error && <div style={styles.error}>Incorrect password. Try again.</div>}

        <button type="submit" style={styles.button}>Unlock</button>

        <p style={styles.note}>Presentation gate only, not a production security control.</p>
      </form>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'radial-gradient(1200px 600px at 50% -10%, #1e293b 0%, #0b1120 60%, #060911 100%)',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: 32,
    borderRadius: 16,
    background: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid rgba(148, 163, 184, 0.18)',
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(8px)',
  },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#7dd3fc',
    background: 'rgba(56, 189, 248, 0.12)',
    padding: '4px 10px',
    borderRadius: 999,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: 0, fontSize: 14, color: '#94a3b8' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    fontSize: 15,
    color: '#f1f5f9',
    background: 'rgba(2, 6, 23, 0.6)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: 10,
    outline: 'none',
  },
  inputError: { borderColor: '#f87171' },
  error: { fontSize: 13, color: '#fca5a5', marginTop: -4 },
  button: {
    padding: '12px 14px',
    fontSize: 15,
    fontWeight: 600,
    color: '#04121f',
    background: 'linear-gradient(180deg, #67e8f9 0%, #22d3ee 100%)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
  },
  note: { margin: 0, fontSize: 11, color: '#64748b', textAlign: 'center' },
};
