// ═══════════════════════════════════════════════════════════════
// TargetAuthPanel.tsx - EPHEMERAL TARGET-APP CREDENTIALS
// ═══════════════════════════════════════════════════════════════
// Collects login details for the application UNDER TEST so exploration can reach
// authenticated surface. Values live in component state for one launch and are
// cleared by the parent immediately after submission — nothing is persisted here,
// and autoComplete is off so the browser does not offer to save them either.

import { useState } from 'react';
import { ChevronDown, KeyRound, ShieldCheck } from 'lucide-react';
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

/**
 * Convert the form draft into the wire contract, or undefined when auth is off or
 * incomplete. Both username and password are required — a partial credential can
 * only ever produce a failed login, which aborts the run.
 */
export function toTargetAuthConfig(draft: TargetAuthDraft): TargetAuthConfig | undefined {
  if (!draft.enabled || !draft.username || !draft.password) return undefined;
  const trimmed = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);
  return {
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
  return draft.enabled && (!draft.username || !draft.password);
}

interface TargetAuthPanelProps {
  draft: TargetAuthDraft;
  onChange: (draft: TargetAuthDraft) => void;
  disabled?: boolean;
}

const FIELD_CLASS =
  'w-full h-9 border border-(--border-strong) rounded-lg px-3 text-[13px] font-sans bg-(--surface-panel) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--border-focus) disabled:bg-(--surface-inset) disabled:text-(--text-disabled)';
const LABEL_CLASS = 'block text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary) mb-1 font-sans';

export default function TargetAuthPanel({ draft, onChange, disabled = false }: TargetAuthPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = <K extends keyof TargetAuthDraft>(key: K, value: TargetAuthDraft[K]): void =>
    onChange({ ...draft, [key]: value });

  const incomplete = isTargetAuthIncomplete(draft);

  return (
    <div className="rounded-lg border border-(--border-hairline) bg-(--surface-raised)">
      <label
        htmlFor="target-auth-enabled"
        className={`flex items-center gap-2.5 px-4 py-2.5 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      >
        <input
          id="target-auth-enabled"
          type="checkbox"
          checked={draft.enabled}
          disabled={disabled}
          onChange={(e) => set('enabled', e.target.checked)}
          className="rounded border-(--border-strong) text-(--surface-invert) focus:ring-(--border-focus) h-3.5 w-3.5"
        />
        <KeyRound className="h-4 w-4 text-(--text-tertiary)" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[11px] font-bold tracking-wider text-(--text-secondary) uppercase font-sans">
          Authenticate into target
        </span>
        <span className="text-[10px] text-(--text-tertiary) font-sans normal-case tracking-normal">
          Explore past the login page
        </span>
      </label>

      {draft.enabled && (
        <div className="border-t border-(--border-hairline) px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS} htmlFor="target-auth-username">Username / Email</label>
              <input
                id="target-auth-username"
                type="text"
                autoComplete="off"
                value={draft.username}
                disabled={disabled}
                onChange={(e) => set('username', e.target.value)}
                className={FIELD_CLASS}
                placeholder="tester@example.com"
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="target-auth-password">Password</label>
              <input
                id="target-auth-password"
                type="password"
                autoComplete="new-password"
                value={draft.password}
                disabled={disabled}
                onChange={(e) => set('password', e.target.value)}
                className={FIELD_CLASS}
                placeholder="••••••••"
              />
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-(--text-tertiary) font-sans">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-px" strokeWidth={1.75} aria-hidden="true" />
            <span>
              Used once for this run and held in memory only — never saved to your history, reports,
              logs, or the job queue. Re-enter them for each run. Use a dedicated test account.
            </span>
          </p>

          {incomplete && (
            <p className="text-[10px] font-semibold text-(--status-critical-fg) font-sans">
              Both a username and a password are required to authenticate.
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary) hover:text-(--text-secondary) transition-colors font-sans"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-150 ${showAdvanced ? 'rotate-180' : ''}`}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Advanced — custom selectors
          </button>

          {showAdvanced && (
            <div className="space-y-3 pt-1">
              <p className="text-[10px] text-(--text-tertiary) font-sans leading-relaxed">
                Leave blank to auto-detect the login form. Set these when the form is multi-step or
                built from custom components, where detection cannot find the fields.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLASS} htmlFor="target-auth-login-url">Login page URL</label>
                  <input
                    id="target-auth-login-url"
                    type="text"
                    value={draft.loginUrl}
                    disabled={disabled}
                    onChange={(e) => set('loginUrl', e.target.value)}
                    className={FIELD_CLASS}
                    placeholder="Defaults to the target URL"
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor="target-auth-success">Success indicator</label>
                  <input
                    id="target-auth-success"
                    type="text"
                    value={draft.successIndicator}
                    disabled={disabled}
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
                    disabled={disabled}
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
                    disabled={disabled}
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
                    disabled={disabled}
                    onChange={(e) => set('submitSelector', e.target.value)}
                    className={FIELD_CLASS}
                    placeholder="button[type='submit']"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
