import { useState, type FormEvent, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { isUnlocked, unlock } from '../../utils/accessLock';

// Development system lock. Blocks the entire app (landing + every route) until the
// shared access password is entered. Persisted in localStorage, so refresh and
// navigation keep it unlocked. Remove this gate when dev-gating ends.
export default function AccessGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (unlock(password)) {
      setUnlocked(true);
      return;
    }
    setError(true);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-(--surface-app) p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--accent) text-(--accent-fg)">
            <Lock className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-(--text-primary)">BugSafari</h1>
            <p className="mt-2 text-sm text-(--text-secondary)">
              Thanks for taking part in the BugSafari survey, but access is currently limited.
            </p>
            <p className="mt-1 text-sm text-(--text-secondary)">
              We're still cooking up something better and working to make BugSafari more useful for student developers.
            </p>
          </div>
        </div>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(false); }}
          placeholder="Developer access password"
          aria-label="Developer access password"
          aria-invalid={error}
          className="w-full rounded-(--radius-md) border border-(--border-hairline) bg-(--surface-panel) px-3 py-2.5 text-sm text-(--text-primary) placeholder:text-(--text-tertiary) outline-none focus:border-(--border-focus) focus-visible:ring-2 focus-visible:ring-(--accent-border)"
        />

        {error && <p className="mt-2 text-sm text-(--status-critical-fg)">Incorrect password.</p>}

        <button
          type="submit"
          className="mt-4 w-full rounded-(--radius-md) bg-(--accent) px-3 py-2.5 text-sm font-semibold text-(--accent-fg) transition-colors hover:cursor-pointer hover:bg-(--accent-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent-border)"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
