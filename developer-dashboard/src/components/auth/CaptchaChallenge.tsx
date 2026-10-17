import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, RefreshCw, LoaderCircle } from 'lucide-react';
import { apiUrl } from '../../utils/apiBase';
import type { CaptchaChallenge as Challenge } from '../../../../shared/types.js';

interface CaptchaChallengeProps {
  answer: string;
  onAnswerChange: (value: string) => void;
  // Reports the signed token to submit; empty while a challenge is loading or failed.
  onTokenChange: (token: string) => void;
  // Inline field error text (client validation); server failures surface in AuthAlert.
  error?: string;
  // Marks the control invalid without inline text, e.g. a server CAPTCHA_FAILED.
  invalid?: boolean;
  // Bump to force a fresh challenge, e.g. after the server rejects an answer.
  reloadSignal?: number;
  disabled?: boolean;
}

const CAPTCHA_ANSWER_MAX = 16;

export default function CaptchaChallenge({
  answer,
  onAnswerChange,
  onTokenChange,
  error,
  invalid: invalidProp,
  reloadSignal = 0,
  disabled = false,
}: CaptchaChallengeProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Hold the latest parent callbacks in refs so the loader stays stable: the fetch
  // effect must not re-run on every parent render (inline callbacks change identity).
  const onAnswerChangeRef = useRef(onAnswerChange);
  const onTokenChangeRef = useRef(onTokenChange);
  useEffect(() => {
    onAnswerChangeRef.current = onAnswerChange;
    onTokenChangeRef.current = onTokenChange;
  });

  // setState runs only after the fetch settles (then/catch/finally), never
  // synchronously inside an effect — keeps renders from cascading before paint.
  const loadChallenge = useCallback(() => {
    onTokenChangeRef.current('');
    return fetch(apiUrl('/api/auth/captcha'), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`captcha ${response.status}`);
        const data = (await response.json()) as Challenge;
        if (typeof data.token !== 'string' || typeof data.prompt !== 'string') throw new Error('malformed challenge');
        setPrompt(data.prompt);
        setLoadError(false);
        onTokenChangeRef.current(data.token);
        onAnswerChangeRef.current('');
      })
      .catch((err) => {
        console.error('[CaptchaChallenge] Failed to load challenge:', err);
        setLoadError(true);
        setPrompt('');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void loadChallenge();
  }, [loadChallenge, reloadSignal]);

  // Manual retry is a user event, so flipping the spinner on here is safe.
  const handleRefresh = () => {
    setLoading(true);
    void loadChallenge();
  };

  const invalid = invalidProp ?? !!error;
  const describedBy = [error ? 'captcha-error' : null, loadError ? 'captcha-load-error' : null]
    .filter(Boolean)
    .join(' ') || undefined;

  const fieldBase =
    'peer w-full h-11 rounded-(--radius-md) border bg-(--surface-panel) pl-10 pr-3 text-base text-(--text-primary) placeholder:text-(--text-tertiary) transition-[color,border-color,box-shadow] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-2 focus:ring-(--accent-border) disabled:opacity-60 disabled:cursor-not-allowed';
  const fieldBorder = invalid ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)';

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor="captcha-answer" className="block text-sm font-medium text-(--text-primary)">
          Verification
        </label>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={disabled || loading}
          className="inline-flex items-center gap-1.5 text-xs text-(--text-tertiary) hover:text-(--text-primary) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm) disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="Load a new challenge"
        >
          <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} aria-hidden="true" />
          New challenge
        </button>
      </div>

      <div
        className="mb-2 flex items-center gap-2 rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-app)/40 px-3 py-2.5 min-h-11"
        aria-live="polite"
      >
        <span className="text-(--text-tertiary)"><ShieldCheck className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /></span>
        {loading ? (
          <span className="inline-flex items-center gap-2 text-sm text-(--text-tertiary)">
            <LoaderCircle className="w-4 h-4 shrink-0 animate-spin" strokeWidth={1.75} aria-hidden="true" />
            Loading challenge...
          </span>
        ) : loadError ? (
          <span className="text-sm text-(--status-critical-fg)">Could not load a challenge.</span>
        ) : (
          <span className="text-sm font-medium text-(--text-primary)">{prompt}</span>
        )}
      </div>

      <div className="relative">
        <input
          id="captcha-answer"
          type="text"
          inputMode="numeric"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Your answer"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          maxLength={CAPTCHA_ANSWER_MAX}
          autoComplete="off"
          disabled={disabled || loading || loadError}
          className={`${fieldBase} ${fieldBorder}`}
        />
        <span className="absolute inset-y-0 left-3 flex items-center text-(--text-tertiary) peer-focus:text-(--text-primary) transition-colors pointer-events-none">
          <ShieldCheck className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        </span>
      </div>

      {loadError && (
        <p id="captcha-load-error" className="mt-1.5 text-sm text-(--status-critical-fg)">
          We couldn&apos;t load the challenge. Use &ldquo;New challenge&rdquo; to retry.
        </p>
      )}
      {error && (
        <p id="captcha-error" className="mt-1.5 text-sm text-(--status-critical-fg)" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
