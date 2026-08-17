// TargetAuthPanel.tsx - EPHEMERAL TARGET-APP CREDENTIALS
// Collects login details for the application UNDER TEST so exploration can reach
// authenticated surface. Values live in component state for one launch and are
// cleared by the parent immediately after submission. autoComplete is off so the
// browser never offers to save them.

import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Eye, EyeOff, HelpCircle, KeyRound, ShieldCheck } from 'lucide-react';
import type { TargetAuthConfig } from '../../types';

export interface TargetAuthDraft {
  enabled: boolean;
  username: string;
  password: string;
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  successIndicator: string;
}

export const emptyTargetAuthDraft: TargetAuthDraft = {
  enabled: false,
  username: '',
  password: '',
  loginUrl: '',
  usernameSelector: '',
  passwordSelector: '',
  submitSelector: '',
  successIndicator: '',
};

// Convert the draft into the wire contract, or undefined when auth is off or incomplete.
export function toTargetAuthConfig(draft: TargetAuthDraft): TargetAuthConfig | undefined {
  if (!draft.enabled || isTargetAuthIncomplete(draft)) return undefined;
  const trimmed = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);

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

// True when auth is enabled but unusable. The parent blocks launch on this.
export function isTargetAuthIncomplete(draft: TargetAuthDraft): boolean {
  if (!draft.enabled) return false;
  return !draft.username || !draft.password;
}

interface TargetAuthPanelProps {
  draft: TargetAuthDraft;
  onChange: (draft: TargetAuthDraft) => void;
  disabled?: boolean;
}

// text-base under `sm` keeps iOS from zooming the viewport on focus.
const FIELD_CLASS =
  'w-full h-10 border border-(--border-strong) rounded-lg px-3 text-base font-sans bg-(--surface-panel) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--border-focus) disabled:bg-(--surface-inset) disabled:text-(--text-disabled)';
const LABEL_CLASS = 'block text-[13px] font-medium text-(--text-primary) mb-1 font-sans';

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

  const incomplete = isTargetAuthIncomplete(draft);
  // Fields stay visible when auth is off, but inert and grayed.
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
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-1 focus-visible:ring-offset-(--surface-raised) ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          } ${draft.enabled ? 'bg-blue-500' : 'bg-zinc-700 border border-zinc-600'}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-[#f4f4f5] shadow-md transition-transform duration-150 ${
              draft.enabled ? 'translate-x-[20px]' : 'translate-x-0.5'
            }`}
          />
        </button>
        <KeyRound className="h-4 w-4 shrink-0 text-(--text-tertiary)" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-(--text-secondary) uppercase font-sans leading-tight">
            Authenticate into target
          </p>
          <p className="text-xs text-(--text-tertiary) font-sans leading-tight mt-0.5">
            Sign in so exploration reaches the pages behind your login
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
              className="border-t border-(--border-hairline) bg-(--surface-inset) px-4 py-3 space-y-2 text-[13px] leading-relaxed text-(--text-tertiary) font-sans"
            >
              <p>
                Give BugSafari a test account so it can explore the pages behind your login, not just the
                sign-in screen. The engine opens the login page, fills the fields, and submits.
              </p>
              <p>
                Add custom selectors under Advanced only when auto-detection cannot find the fields, such as
                a multi-step form or one built from custom components.
              </p>
              <p>Credentials are used once for this run and held in memory only. Use a dedicated test account.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`border-t border-(--border-hairline) px-4 py-3 space-y-3 ${!draft.enabled ? 'opacity-60' : ''}`}>
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

        {incomplete && (
          <p role="alert" className="text-xs font-semibold text-(--status-critical-fg) font-sans">
            Both a username and a password are required to authenticate.
          </p>
        )}

        <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-(--text-tertiary) font-sans">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-px" strokeWidth={1.75} aria-hidden="true" />
          <span>
            Used once for this run and held in memory only, never saved to your history, reports, logs, or
            the job queue. Re-enter them for each run. Use a dedicated test account.
          </span>
        </p>

        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          disabled={fieldsDisabled}
          aria-expanded={showAdvanced}
          className="flex items-center gap-1 text-xs font-bold uppercase text-(--text-tertiary) enabled:hover:text-(--text-secondary) transition-colors font-sans disabled:cursor-not-allowed enabled:cursor-pointer"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-150 ${showAdvanced ? 'rotate-180' : ''}`}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          Advanced (custom selectors)
        </button>

        <AnimatePresence initial={false}>
          {showAdvanced && (
            <motion.div key="target-auth-advanced" {...COLLAPSE_MOTION} className="space-y-3 overflow-hidden pt-1">
              <p className="text-xs text-(--text-tertiary) font-sans leading-relaxed">
                Leave blank to auto-detect. The engine finds the login form on the target, behind a Login /
                Sign In control, or at a common auth route. Set these when the form is multi-step or built from
                custom components, where detection cannot find the fields.
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
                    placeholder="Optional, where to start looking"
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
