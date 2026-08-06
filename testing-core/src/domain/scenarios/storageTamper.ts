/**
 * Storage Tamper — client auth-state & JWT tampering scenario (broken access control).
 *
 * Complements the arsenal (which floods clicks, injects payloads, races async work)
 * by attacking the AUTHORIZATION dimension nothing else targets: whether the SPA
 * derives privilege from CLIENT-TRUSTED state instead of enforcing it server-side.
 * OWASP A01. For the current page it:
 *
 *   1. Snapshots the privileged-surface markers currently rendered (baseline) and
 *      the auth-shaped keys in localStorage/sessionStorage/cookies.
 *   2. Forges escalated client state: role/admin/isAuthenticated flags flipped to
 *      privileged values, and any JWT-shaped token re-minted with `alg:none` and
 *      escalated claims (role=admin). Original values are recorded for restore.
 *   3. Reloads the same URL (confinement-safe — never leaves the origin) so the app
 *      re-renders from the tampered state, then re-counts privileged-surface markers.
 *   4. Oracle: a finding is asserted ONLY when privileged UI appeared that was ABSENT
 *      before the tamper (a strict delta) — proof the client granted authorization
 *      from forged state alone. A surface already visible pre-tamper is NOT flagged.
 *   5. Restores the original client state and reloads once more so the tamper never
 *      poisons subsequent exploration (deterministic, side-effect-free across steps).
 *
 * Unlike the console-monitor-driven scenarios, this one is a positive ORACLE: the
 * fault is self-asserted via {@link decideStorageVerdict} and registered by the
 * ActionExecutor adapter (classifyFault confirmed=true). Every browser call is
 * guarded so a detached/closed page never throws; the scenario is confined, bounded,
 * and deterministic (fixed escalation values — no RNG).
 */

import type { Page, Response } from 'playwright';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
import type { ChaosTransactionManager, StorageTamperMetadata } from '../chaos/index.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveElementLabel } from '../services/forensics/narration.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[StressScenario:StorageTamper]');

/** Default target label when the scenario runs without a specific element. */
const DEFAULT_SELECTOR = 'body';
/** Bounded reload timeout — a slow re-render must never hang the run. */
const RELOAD_TIMEOUT_MS = 5000;

// Same-origin request paths that only a privileged/authorized session should be able
// to load. A 2xx here AFTER the forge is server-side corroboration that the escalated
// state was honored — not merely painted client-side.
const PRIVILEGED_PATH_RE = /(admin|dashboard|privileg|permission|\brole|manage|internal|users?\/all|audit)/i;

/** Same-origin GET/data request that returned 2xx to a privileged-looking endpoint. */
function isPrivilegedServerResponse(response: Response, pageOrigin: string): boolean {
  try {
    if (response.status() < 200 || response.status() >= 300) return false;
    const request = response.request();
    const method = request.method().toUpperCase();
    if (method !== 'GET') return false; // a data read the client is authorized for
    const type = request.resourceType();
    if (type !== 'xhr' && type !== 'fetch' && type !== 'document') return false;
    const url = new URL(response.url());
    if (pageOrigin && url.origin !== pageOrigin) return false;
    return PRIVILEGED_PATH_RE.test(url.pathname);
  } catch {
    return false;
  }
}

/** A self-asserted client-trust finding handed to the ActionExecutor sink. */
export interface StorageTamperFinding {
  message: string;
  selector: string;
  evidence: string;
  /**
   * True only when the SERVER corroborated the escalation — a privileged same-origin
   * request succeeded (2xx) after the forge. Render-only deltas leave this false, so
   * the sink reports NEEDS_VERIFICATION ("client renders privileged UI from untrusted
   * state; server enforcement unverified") instead of a CRITICAL confirmed bypass. This
   * is the fix for the audit's C1 over-claim: a client that optimistically paints an
   * "admin" class but whose API still 403s is NOT a broken-access-control defect.
   */
  serverConfirmed: boolean;
}

/** Dependencies injected by the ActionExecutor adapter (mirrors asyncStateRacer). */
export interface StorageTamperContext {
  chaosManager?: ChaosTransactionManager<StorageTamperMetadata> | null;
  registerFinding?: (finding: StorageTamperFinding) => void;
}

// ─────────────────────────────────────────────────────────────
// Pure oracle core (unit-testable without a browser).
// ─────────────────────────────────────────────────────────────

/** Whole-word auth/identity/privilege tokens a storage key may carry. */
export const AUTH_KEY_TERMS: readonly string[] = [
  'role', 'roles', 'admin', 'auth', 'authenticated', 'user', 'token', 'jwt',
  'session', 'access', 'refresh', 'permission', 'permissions', 'priv',
  'scope', 'scopes', 'claim', 'claims', 'logged', 'login', 'logout',
];

/** Split camelCase into token boundaries so `authToken` → `auth_token`. */
function normalizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Storage/cookie key looks like it carries auth/identity/privilege state. */
export function matchesAuthKey(key: string): boolean {
  const norm = normalizeKey(key);
  return AUTH_KEY_TERMS.some((term) => new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`).test(norm));
}

export type StorageVerdict = 'GAINED' | 'NONE' | 'ABSENT';

/**
 * Decide whether tampering unlocked privileged UI. A finding is warranted ONLY on a
 * strict positive delta: privileged markers appeared AFTER the tamper that were
 * ABSENT before. Markers already visible pre-tamper (a genuinely authenticated
 * session) yield NONE; no markers at all yields ABSENT. Conservative by design —
 * it never flags a surface the app was already rendering.
 */
export function decideStorageVerdict(params: { before: number; after: number }): StorageVerdict {
  const { before, after } = params;
  if (after <= 0) return 'ABSENT';
  if (after > before) return 'GAINED';
  return 'NONE';
}

// ─────────────────────────────────────────────────────────────
// Browser-side probes/mutations (evaluated inside the target page).
// ─────────────────────────────────────────────────────────────

/** Selectors whose visible presence indicates a privileged/admin-only surface. */
const PRIVILEGED_SELECTORS: readonly string[] = [
  '[data-role="admin"]',
  '[data-admin]',
  '[data-testid*="admin" i]',
  '[class*="admin" i]',
  '[id*="admin" i]',
  '[href*="/admin" i]',
  '[class*="dashboard" i]',
  '[id*="dashboard" i]',
  '[data-role="privileged"]',
  '[aria-label*="admin" i]',
];

/** Count VISIBLE privileged-surface markers currently rendered. Never throws. */
async function countPrivilegedSurface(page: Page): Promise<number> {
  return page
    .evaluate((selectors) => {
      const isVisible = (el: Element): boolean => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = window.getComputedStyle(el as HTMLElement);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const seen = new Set<Element>();
      for (const sel of selectors) {
        let nodes: NodeListOf<Element>;
        try {
          nodes = document.querySelectorAll(sel);
        } catch {
          continue; // invalid selector in this browser — skip
        }
        nodes.forEach((n) => {
          if (isVisible(n)) seen.add(n);
        });
      }
      return seen.size;
    }, [...PRIVILEGED_SELECTORS])
    .catch(() => 0);
}

/** Snapshot of what the tamper touched, returned from the browser mutation. */
interface TamperResult {
  tamperedKeys: string[];
  jwtForged: boolean;
  /** Serialized original state so the scenario can restore it verbatim. */
  restore: {
    local: Record<string, string | null>;
    session: Record<string, string | null>;
  };
}

/**
 * Forge escalated client auth-state in-page. Deterministic (fixed values), never
 * throws. Records originals (null = key was absent → remove on restore) so the
 * mutation is fully reversible.
 */
async function tamperClientState(page: Page): Promise<TamperResult> {
  return page
    .evaluate((terms) => {
      const normalize = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      const isAuthKey = (key: string): boolean => {
        const norm = normalize(key);
        return terms.some((term) => new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`).test(norm));
      };
      const tamperedKeys: string[] = [];
      let jwtForged = false;
      const restore = {
        local: {} as Record<string, string | null>,
        session: {} as Record<string, string | null>,
      };

      const b64urlEncode = (s: string): string =>
        btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // Re-mint a JWT-shaped token with alg:none and escalated claims. Returns the
      // forged token, or null when the value is not a decodable 3-segment JWT.
      const forgeJwt = (value: string): string | null => {
        const parts = value.split('.');
        if (parts.length !== 3) return null;
        let claims: Record<string, unknown>;
        try {
          const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          claims = JSON.parse(atob(pad)) as Record<string, unknown>;
        } catch {
          return null;
        }
        claims.role = 'admin';
        claims.admin = true;
        claims.isAdmin = true;
        claims.scope = 'admin';
        const header = b64urlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
        const payload = b64urlEncode(JSON.stringify(claims));
        return `${header}.${payload}.`;
      };

      // Escalate a single stored value based on its shape.
      const escalate = (value: string): { next: string; jwt: boolean } => {
        const forged = forgeJwt(value);
        if (forged) return { next: forged, jwt: true };
        const trimmed = value.trim();
        if (trimmed === 'false' || trimmed === '0') return { next: 'true', jwt: false };
        try {
          const parsed = JSON.parse(value) as unknown;
          if (parsed && typeof parsed === 'object') {
            const obj = parsed as Record<string, unknown>;
            obj.role = 'admin';
            obj.isAdmin = true;
            obj.admin = true;
            obj.isAuthenticated = true;
            return { next: JSON.stringify(obj), jwt: false };
          }
        } catch {
          /* not JSON — fall through */
        }
        return { next: 'admin', jwt: false };
      };

      const tamperStore = (store: Storage, bucket: Record<string, string | null>): void => {
        const keys: string[] = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k) keys.push(k);
        }
        for (const key of keys) {
          if (!isAuthKey(key)) continue;
          const original = store.getItem(key);
          const { next, jwt } = escalate(original ?? '');
          bucket[key] = original; // record for restore
          try {
            store.setItem(key, next);
            tamperedKeys.push(key);
            if (jwt) jwtForged = true;
          } catch {
            /* quota/readonly — skip */
          }
        }
      };

      try {
        tamperStore(window.localStorage, restore.local);
      } catch {
        /* storage disabled */
      }
      try {
        tamperStore(window.sessionStorage, restore.session);
      } catch {
        /* storage disabled */
      }

      // Seed canonical privileged flags when the app exposes none — the whole point
      // is to test a client that trusts these keys even if it didn't set them yet.
      const seed: Record<string, string> = { role: 'admin', isAdmin: 'true', isAuthenticated: 'true' };
      for (const [key, val] of Object.entries(seed)) {
        try {
          if (window.localStorage.getItem(key) === null) {
            restore.local[key] = null; // absent → remove on restore
            window.localStorage.setItem(key, val);
            tamperedKeys.push(key);
          }
        } catch {
          /* storage disabled */
        }
      }

      // Non-HttpOnly cookies the client may read for gating (best-effort).
      try {
        document.cookie = 'role=admin; path=/';
        document.cookie = 'isAdmin=true; path=/';
      } catch {
        /* cookies disabled */
      }

      return { tamperedKeys, jwtForged, restore };
    }, [...AUTH_KEY_TERMS])
    .catch(() => ({ tamperedKeys: [], jwtForged: false, restore: { local: {}, session: {} } }));
}

/** Re-apply the recorded originals (null → remove the key). Returns success. */
async function restoreClientState(page: Page, restore: TamperResult['restore']): Promise<boolean> {
  return page
    .evaluate((snapshot) => {
      const apply = (store: Storage, bucket: Record<string, string | null>): void => {
        for (const [key, value] of Object.entries(bucket)) {
          try {
            if (value === null) store.removeItem(key);
            else store.setItem(key, value);
          } catch {
            /* storage disabled */
          }
        }
      };
      try {
        apply(window.localStorage, snapshot.local);
      } catch {
        /* ignore */
      }
      try {
        apply(window.sessionStorage, snapshot.session);
      } catch {
        /* ignore */
      }
      try {
        document.cookie = 'role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'isAdmin=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      } catch {
        /* ignore */
      }
      return true;
    }, restore)
    .catch(() => false);
}

async function safeReload(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: RELOAD_TIMEOUT_MS }).catch(() => undefined);
}

export const storageTamper = {
  name: 'StorageTamper',

  async execute(page: Page, target?: InteractiveElement, ctx?: StorageTamperContext): Promise<void> {
    if (page.isClosed()) return;

    const selector = target?.selector ?? DEFAULT_SELECTOR;
    const label = target ? resolveElementLabel(target) : 'client auth state';
    const manager = ctx?.chaosManager ?? null;

    obsLog.info(`[StressScenario:StorageTamper] Forging client auth-state on '${page.url()}'`);

    const metadata: StorageTamperMetadata = {
      targetSelector: selector,
      tamperedKeys: [],
      jwtForged: false,
      privilegedMarkersBefore: 0,
      privilegedMarkersAfter: 0,
      privilegedSurfaceGained: false,
      resultingState: 'restored',
    };

    manager?.startTransaction(selector, 'STORAGE_TAMPER', metadata);
    ActiveScenarioTracker.record(`Forge escalated auth-state (role=admin, alg=none JWT) in client storage on "${label}".`);

    let restore: TamperResult['restore'] = { local: {}, session: {} };
    try {
      // 1) Baseline privileged surface.
      const before = await countPrivilegedSurface(page);
      metadata.privilegedMarkersBefore = before;

      // 2) Forge escalated client state.
      const result = await tamperClientState(page);
      restore = result.restore;
      metadata.tamperedKeys = result.tamperedKeys;
      metadata.jwtForged = result.jwtForged;

      // 3) Re-render from tampered state (same URL — confinement-safe), watching for a
      // privileged same-origin 2xx: server-side corroboration that the forged state was
      // actually honored, not merely painted client-side.
      const pageOrigin = (() => {
        try {
          return new URL(page.url()).origin;
        } catch {
          return '';
        }
      })();
      let serverConfirmed = false;
      const onResponse = (response: Response): void => {
        if (!serverConfirmed && isPrivilegedServerResponse(response, pageOrigin)) serverConfirmed = true;
      };
      page.on('response', onResponse);
      try {
        await safeReload(page);
        // Brief settle so a privileged data fetch issued on mount can land before we judge.
        if (!page.isClosed()) await page.waitForTimeout(600).catch(() => undefined);
      } finally {
        page.off('response', onResponse);
      }

      // 4) Oracle: did privileged UI appear that was absent before?
      const after = await countPrivilegedSurface(page);
      metadata.privilegedMarkersAfter = after;
      const verdict = decideStorageVerdict({ before, after });
      metadata.privilegedSurfaceGained = verdict === 'GAINED';

      if (verdict === 'GAINED') {
        const keys = result.tamperedKeys.join(', ') || '(seeded canonical flags)';
        const forgeDetail = `(keys: ${keys}${result.jwtForged ? '; JWT re-minted alg=none role=admin' : ''})`;
        const evidence = serverConfirmed
          ? `Privileged surface markers rose ${before} → ${after} after forging client auth-state ${forgeDetail}, ` +
            `AND a privileged same-origin request returned 2xx under the forged state. ` +
            `The server honored tampered client state — broken access control (server authorization bypassed).`
          : `Privileged surface markers rose ${before} → ${after} after forging client auth-state ${forgeDetail}. ` +
            `The client rendered privileged UI from untrusted client state, but no privileged server request was ` +
            `observed to succeed — server-side enforcement is UNVERIFIED. Confirm whether protected data/actions are ` +
            `actually reachable under the forged state before treating this as an access-control bypass.`;
        ActiveScenarioTracker.record(evidence);
        ctx?.registerFinding?.({
          message: serverConfirmed
            ? `Broken access control: server honored forged client auth-state on ${page.url()}`
            : `Client renders privileged UI from forged storage (server enforcement unverified) on ${page.url()}`,
          selector,
          evidence,
          serverConfirmed,
        });
      }
      // No ActionRecorder step here: a storage forge is not a typed input, has no
      // literal replay path (reproduced via the finding's stateFingerprint restore),
      // and recording it as INPUT polluted unrelated findings' minimized traces.
      // The GAINED-only ActiveScenarioTracker.record above carries the human step.
    } catch (error) {
      metadata.resultingState = 'error';
      obsLog.error(
        `[StressScenario:StorageTamper] Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
    } finally {
      // 5) Restore baseline so the tamper never poisons later exploration.
      const restored = await restoreClientState(page, restore);
      if (metadata.resultingState !== 'error') {
        metadata.resultingState = restored ? 'restored' : 'restore-failed';
      }
      await safeReload(page);
      manager?.endTransaction();
      obsLog.info(
        `[StressScenario:StorageTamper] Completed: keys=${metadata.tamperedKeys.length}, ` +
          `jwtForged=${metadata.jwtForged}, gained=${metadata.privilegedSurfaceGained}, state=${metadata.resultingState}`,
      );
    }
  },
};

export type StorageTamper = typeof storageTamper;
