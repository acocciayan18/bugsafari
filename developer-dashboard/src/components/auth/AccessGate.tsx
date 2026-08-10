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
      // Reload so boot-time store init re-runs with the access header present.
      window.location.reload();
      return;
    }
    setError(true);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white">
            <Lock className="h-6 w-6" strokeWidth={1.75} />
          </div>
         <div>
  <h1 className="text-lg font-bold text-neutral-900">BugSafari</h1>
  <p className="mt-2 text-sm text-neutral-600">
    Thanks for taking part in the BugSafari survey, but access is currently limited.
  </p>
  <p className="mt-1 text-sm text-neutral-600">
    We’re still cooking up something better and working to make BugSafari more useful for student developers.
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
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        />

        {error && <p className="mt-2 text-sm text-red-500">Incorrect password.</p>}

        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-neutral-900 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:cursor-pointer hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
