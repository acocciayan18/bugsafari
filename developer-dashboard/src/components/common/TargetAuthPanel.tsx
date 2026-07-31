// ═══════════════════════════════════════════════════════════════
// TargetAuthPanel.tsx - EPHEMERAL TARGET-APP CREDENTIALS
// ═══════════════════════════════════════════════════════════════
// Collects login details for the application UNDER TEST so exploration can reach
// authenticated surface. Values live in component state for one launch and are
// cleared by the parent immediately after submission — nothing is persisted here,
// and autoComplete is off so the browser does not offer to save them either.

import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Eye, EyeOff, HelpCircle, KeyRound, ShieldCheck } from 'lucide-react';
import type { TargetAuthConfig } from '../../types';

export type TargetAuthMethod = 'credentials' | 'storageState';

export interface TargetAuthDraft {
  enabled: boolean;
  method: TargetAuthMethod;
  username: string;
  password: string;
  storageState: string;
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successIndicator: string;
}

export const emptyTargetAuthDraft: TargetAuthDraft = {
  enabled: false,
  method: 'credentials',
  username: '',
  password: '',
  storageState: '',
  loginUrl: '',
  usernameSelector: '',
  passwordSelector: '',
  submitSelector: '',
  successIndicator: '',
};

/** Structural check mirroring the backend's parseStorageState — same reject, earlier. */
export function isStorageStateValid(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    const { cookies, origins } = parsed as { cookies?: unknown; origins?: unknown };
    if (!Array.isArray(cookies) || !Array.isArray(origins)) return false;
    return cookies.length > 0 || origins.length > 0;
  } catch {
    return false;
  }
}

/**
 * Convert the form draft into the wire contract, or undefined when auth is off or
 * incomplete. A form login needs both username and password; a seeded session needs
 * storageState that parses — anything less can only produce a failed launch.
 */
export function toTargetAuthConfig(draft: TargetAuthDraft): TargetAuthConfig | undefined {
  if (!draft.enabled || isTargetAuthIncomplete(draft)) return undefined;
  const trimmed = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);

  if (draft.method === 'storageState') {
    return {
      mode: 'storageState',
      storageState: draft.storageState.trim(),
      successIndicator: trimmed(draft.successIndicator),
    };
  }

  return {
    mode: 'credentials',
    username: draft.username,
    password: draft.password,
    loginUrl: trimmed(draft.loginUrl),
    usernameSelector: trimmed(draft.usernameSelector),
    passwordSelector: trimmed(draft.passwordSelector),
    submitSelector: trimmed(draft.submitSelector),
    successIndicator: trimmed(draft.successIndicator),
  };
}

/** True when auth is enabled but unusable — the parent blocks launch on this. */
export function isTargetAuthIncomplete(draft: TargetAuthDraft): boolean {
  if (!draft.enabled) return false;
  return draft.method === 'storageState'
    ? !isStorageStateValid(draft.storageState.trim())
    : !draft.username || !draft.password;
}

interface TargetAuthPanelProps {
  draft: TargetAuthDraft;
  onChange: (draft: TargetAuthDraft) => void;
  disabled?: boolean;
}

// text-base under `sm` keeps iOS from zooming the viewport on focus.
const FIELD_CLASS =
  'w-full h-10 border border-(--border-strong) rounded-lg px-3 text-base sm:text-sm font-sans bg-(--surface-panel) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--border-focus) disabled:bg-(--surface-inset) disabled:text-(--text-disabled)';
const LABEL_CLASS = 'block text-[12px] font-bold uppercase r text-(--text-tertiary) mb-1 font-sans';

// Session state temporarily disabled — button rendered inert, not removed.
const METHOD_OPTIONS: ReadonlyArray<{ id: TargetAuthMethod; label: string; disabled?: boolean }> = [
  { id: 'credentials', label: 'Login form' },
  { id: 'storageState', label: 'Session state', disabled: true },
];

// Shared collapse choreography for the help and advanced regions.
const COLLAPSE_MOTION = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto' as const, opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
};

export default function TargetAuthPanel({ draft, onChange, disabled = false }: TargetAuthPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const helpId = useId();
  const set = <K extends keyof TargetAuthDraft>(key: K, value: TargetAuthDraft[K]): void =>
    onChange({ ...draft, [key]: value });

  // Switching method drops the other mode's secrets rather than parking them in
  // memory for the tab's lifetime. toTargetAuthConfig already ignores them.
  const setMethod = (method: TargetAuthMethod): void => {
    // Never leave the field revealed across a switch — the next password typed in
    // would start visible without the operator having asked for that.
    setShowPassword(false);
    onChange(method === 'credentials'
      ? { ...draft, method, storageState: '' }
      : { ...draft, method, username: '', password: '' });
  };

  const incomplete = isTargetAuthIncomplete(draft);
  // Config stays visible when auth is off, but every input is inert and grayed —
  // the operator sees what they'd fill without being able to edit a dormant form.
  const fieldsDisabled = disabled || !draft.enabled;

  return (
    <div className="rounded-lg border border-(--border-hairline) bg-(--surface-raised)">
      <div className={`flex items-center gap-3 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label="Authenticate into target"
          disabled={disabled}
          onClick={() => set('enabled', !draft.enabled)}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-1 focus-visible:ring-offset-(--surface-raised) ${disabled ? '' : 'cursor-pointer'} ${draft.enabled ? 'bg-(--surface-invert)' : 'bg-(--border-strong)'}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-(--surface-panel) shadow-sm transition-transform duration-150 ${draft.enabled ? 'translate-x-[20px]' : 'translate-x-0.5'}`}
          />
        </button>
        <KeyRound className="h-4 w-4 shrink-0 text-(--text-tertiary)" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold r text-(--text-secondary) uppercase font-sans leading-tight">
            Authenticate into target
          </p>
          <p className="text-xs text-(--text-tertiary) font-sans leading-tight mt-0.5">
            Explore past the login page
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp((prev) => !prev)}
          aria-expanded={showHelp}
          aria-controls={helpId}
          aria-label="How target authentication works"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--text-tertiary) hover:text-(--text-secondary) hover:bg-(--surface-hover) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) cursor-pointer"
        >
          <HelpCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showHelp && (
        <motion.div key="target-auth-help" {...COLLAPSE_MOTION} className="overflow-hidden">
        <div
          id={helpId}
          role="region"
          aria-label="Target authentication help"
          className="border-t border-(--border-hairline) bg-(--surface-inset) px-4 py-3 space-y-2.5 text-xs leading-relaxed text-(--text-secondary) font-sans"
        >
          <p>
            Give BugSafari a way in so it can explore the pages behind your login, not just the sign-in
            screen. Pick whichever method matches how your target authenticates.
          </p>
          <div>
            <p className="font-bold text-(--text-primary)">Login form — email &amp; password</p>
            <p className="text-(--text-tertiary)">
              The engine opens the login page, fills the fields, and submits. Best for ordinary
              username/password forms. Add custom selectors under Advanced only if auto-detection
              misses the fields.
            </p>
          </div>
          <div>
            <p className="font-bold text-(--text-primary)">Session state — storageState JSON</p>
            <p className="text-(--text-tertiary)">
              Seed a session you already established out of band. Use this when a form fill can't drive
              the login: SSO/OAuth redirects, MFA, or captcha. Export it with
              {' '}<code>await context.storageState()</code> from a logged-in Playwright session.
            </p>
          </div>
          <p className="text-(--text-tertiary)">
            Either way the credentials are used once for this run and held in memory only. Use a
            dedicated test account.
          </p>
        </div>
        </motion.div>
        )}
      </AnimatePresence>

      <div className={`border-t border-(--border-hairline) px-4 py-3 space-y-3 ${!draft.enabled ? 'opacity-60' : ''}`}>
        <div role="radiogroup" aria-label="Authentication method" className="grid grid-cols-2 gap-2">
          {METHOD_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={draft.method === option.id}
              aria-disabled={option.disabled}
              disabled={fieldsDisabled || option.disabled}
              title={option.disabled ? 'Session state is temporarily unavailable' : undefined}
              onClick={() => setMethod(option.id)}
              className={`h-9 rounded-lg border px-3 text-xs font-bold uppercase r font-sans transition-colors disabled:cursor-not-allowed enabled:cursor-pointer ${
                option.disabled ? 'opacity-50' : ''
              } ${
                draft.method === option.id
                  ? 'border-(--border-focus) bg-(--surface-inset) text-(--text-primary)'
                  : 'border-(--border-hairline) text-(--text-tertiary) enabled:hover:text-(--text-secondary)'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {draft.method === 'credentials' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS} htmlFor="target-auth-username">Username / Email</label>
              <input
                id="target-auth-username"
                type="text"
                autoComplete="off"
                value={draft.username}
                disabled={fieldsDisabled}
                onChange={(e) => set('username', e.target.value)}
                className={FIELD_CLASS}
                placeholder="example@email.com"
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="target-auth-password">Password</label>
              <div className="relative">
                <input
                  id="target-auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={draft.password}
                  disabled={fieldsDisabled}
                  onChange={(e) => set('password', e.target.value)}
                  className={`${FIELD_CLASS} pr-10`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={fieldsDisabled}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="target-auth-password"
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-(--text-tertiary) transition-colors enabled:cursor-pointer enabled:hover:text-(--text-secondary) disabled:text-(--text-disabled) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--border-focus)"
                >
                  {showPassword
                    ? <EyeOff className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    : <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className={LABEL_CLASS} htmlFor="target-auth-storage-state">Playwright storageState JSON</label>
            <textarea
              id="target-auth-storage-state"
              rows={5}
              spellCheck={false}
              autoComplete="off"
              value={draft.storageState}
              disabled={fieldsDisabled}
              onChange={(e) => set('storageState', e.target.value)}
              className={`${FIELD_CLASS} h-auto py-2 font-mono text-xs resize-y`}
              placeholder='{"cookies":[…],"origins":[…]}'
            />
            <p className="mt-1 text-xs text-(--text-tertiary) font-sans leading-relaxed">
              Paste the output of <code>context.storageState()</code>. Use this for SSO, OAuth, MFA,
              or captcha-guarded logins that a form fill cannot drive.
            </p>
            <div className="mt-3">
              <label className={LABEL_CLASS} htmlFor="target-auth-state-success">Success indicator</label>
              <input
                id="target-auth-state-success"
                type="text"
                value={draft.successIndicator}
                disabled={fieldsDisabled}
                onChange={(e) => set('successIndicator', e.target.value)}
                className={FIELD_CLASS}
                placeholder="Optional — defaults to a login-wall check"
              />
            </div>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-(--text-tertiary) font-sans">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-px" strokeWidth={1.75} aria-hidden="true" />
          <span>
            Used once for this run and held in memory only — never saved to your history, reports,
            logs, or the job queue. Re-enter them for each run. Use a dedicated test account.
          </span>
        </p>

        {incomplete && (
          <p role="alert" className="text-xs font-semibold text-(--status-critical-fg) font-sans">
            {draft.method === 'storageState'
              ? 'Session state must be JSON with a non-empty "cookies" or "origins" array.'
              : 'Both a username and a password are required to authenticate.'}
          </p>
        )}

        {/* Selector overrides drive the form fill only — a seeded session submits nothing. */}
        {draft.method === 'credentials' && (
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          disabled={fieldsDisabled}
          aria-expanded={showAdvanced}
          className="flex items-center gap-1 text-xs font-bold uppercase r text-(--text-tertiary) enabled:hover:text-(--text-secondary) transition-colors font-sans disabled:cursor-not-allowed enabled:cursor-pointer"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-150 ${showAdvanced ? 'rotate-180' : ''}`}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          Advanced — custom selectors
        </button>
        )}

        <AnimatePresence initial={false}>
        {showAdvanced && draft.method === 'credentials' && (
          <motion.div key="target-auth-advanced" {...COLLAPSE_MOTION} className="space-y-3 overflow-hidden pt-1">
            <p className="text-xs text-(--text-tertiary) font-sans leading-relaxed">
              Leave blank to auto-detect. The engine finds the login form on the target, behind a
              Login/Sign In control, or at a common auth route. Set these when the form is
              multi-step or built from custom components, where detection cannot find the fields.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS} htmlFor="target-auth-login-url">Login page URL</label>
                <input
                  id="target-auth-login-url"
                  type="text"
                  value={draft.loginUrl}
                  disabled={fieldsDisabled}
                  onChange={(e) => set('loginUrl', e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="Optional — where to start looking"
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="target-auth-success">Success indicator</label>
                <input
                  id="target-auth-success"
                  type="text"
                  value={draft.successIndicator}
                  disabled={fieldsDisabled}
                  onChange={(e) => set('successIndicator', e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="e.g. [data-testid='dashboard']"
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="target-auth-user-sel">Username selector</label>
                <input
                  id="target-auth-user-sel"
                  type="text"
                  value={draft.usernameSelector}
                  disabled={fieldsDisabled}
                  onChange={(e) => set('usernameSelector', e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="#email"
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="target-auth-pass-sel">Password selector</label>
                <input
                  id="target-auth-pass-sel"
                  type="text"
                  value={draft.passwordSelector}
                  disabled={fieldsDisabled}
                  onChange={(e) => set('passwordSelector', e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="#password"
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="target-auth-submit-sel">Submit selector</label>
                <input
                  id="target-auth-submit-sel"
                  type="text"
                  value={draft.submitSelector}
                  disabled={fieldsDisabled}
                  onChange={(e) => set('submitSelector', e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="button[type='submit']"
                />
              </div>
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  );
}
