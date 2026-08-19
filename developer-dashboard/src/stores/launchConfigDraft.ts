// Persists the operator's pre-launch config (Infiltration profile, Duration, Navigation
// boundary, and the Target Auth STRUCTURE) so choices survive runs, reloads, and restarts.
// The auth password is deliberately excluded: it stays memory-only and is re-entered
// each run, preserving the "never saved" credential contract in TargetAuthPanel.

import {
  DEFAULT_BOUNDARY_LOCK_MODE,
  DEFAULT_TEST_DURATION_ID,
  DEFAULT_INFILTRATION_PROFILE,
  INFILTRATION_PROFILE_CATALOG,
  TEST_DURATION_PRESETS,
  type BoundaryLockMode,
  type InfiltrationProfileId,
  type TestDurationId,
} from '../types';
// Type-only: keeps this store free of the component's runtime deps (React, framer-motion)
// so the zero-dep node test runner can import it.
import type { TargetAuthDraft } from '../components/common/TargetAuthPanel';

const STORAGE_KEY = 'bugsafari.launchConfigDraft';

// Auth minus the secret. Password is never serialized.
type PersistedAuth = Omit<TargetAuthDraft, 'password'>;

export interface LaunchConfigDraft {
  profile: InfiltrationProfileId;
  duration: TestDurationId;
  boundaryMode: BoundaryLockMode;
  auth: TargetAuthDraft;
}

// Mirrors emptyTargetAuthDraft; kept local to avoid a runtime import of the panel.
const EMPTY_AUTH: TargetAuthDraft = {
  enabled: false,
  username: '',
  password: '',
  loginUrl: '',
  usernameSelector: '',
  passwordSelector: '',
  submitSelector: '',
  successIndicator: '',
};

const VALID_PROFILES = new Set<string>(INFILTRATION_PROFILE_CATALOG.map((p) => p.id));
const VALID_DURATIONS = new Set<string>(TEST_DURATION_PRESETS.map((p) => p.id));
const VALID_BOUNDARIES = new Set<BoundaryLockMode>(['exact', 'subtree', 'site']);

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

// Rebuild a full draft from stored structure, forcing password back to empty.
function reviveAuth(raw: unknown): TargetAuthDraft {
  if (!raw || typeof raw !== 'object') return EMPTY_AUTH;
  const a = raw as Partial<PersistedAuth>;
  return {
    enabled: typeof a.enabled === 'boolean' ? a.enabled : false,
    username: asString(a.username),
    password: '',
    loginUrl: asString(a.loginUrl),
    usernameSelector: asString(a.usernameSelector),
    passwordSelector: asString(a.passwordSelector),
    submitSelector: asString(a.submitSelector),
    successIndicator: asString(a.successIndicator),
  };
}

const defaults = (): LaunchConfigDraft => ({
  profile: DEFAULT_INFILTRATION_PROFILE,
  duration: DEFAULT_TEST_DURATION_ID,
  boundaryMode: DEFAULT_BOUNDARY_LOCK_MODE,
  auth: EMPTY_AUTH,
});

// Missing, malformed, or unreadable storage all fall back to first-run defaults.
export function readLaunchConfigDraft(): LaunchConfigDraft {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults();
    const parsed = JSON.parse(stored) as Partial<LaunchConfigDraft>;
    return {
      profile: VALID_PROFILES.has(parsed.profile as string)
        ? (parsed.profile as InfiltrationProfileId)
        : DEFAULT_INFILTRATION_PROFILE,
      duration: VALID_DURATIONS.has(parsed.duration as string)
        ? (parsed.duration as TestDurationId)
        : DEFAULT_TEST_DURATION_ID,
      boundaryMode: VALID_BOUNDARIES.has(parsed.boundaryMode as BoundaryLockMode)
        ? (parsed.boundaryMode as BoundaryLockMode)
        : DEFAULT_BOUNDARY_LOCK_MODE,
      auth: reviveAuth(parsed.auth),
    };
  } catch {
    return defaults();
  }
}

// Strips the password before writing so the secret never reaches disk.
export function writeLaunchConfigDraft(draft: LaunchConfigDraft): void {
  try {
    // password:undefined is dropped by JSON.stringify, so the secret never reaches disk.
    const auth = { ...draft.auth, password: undefined };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: draft.profile, duration: draft.duration, boundaryMode: draft.boundaryMode, auth }),
    );
  } catch {
    // Storage unavailable (private mode, quota) — non-fatal, choices just won't persist.
  }
}
