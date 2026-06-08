import { isValidObjectId, Types } from 'mongoose';
import { SavedSafari, type ISavedSafari } from '../schemas/SavedSafariModel.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bug type definitions for filtering.
 * Only these types represent actual bugs that should be counted.
 */
const VALID_BUG_TYPES = new Set([
  'EXCEPTION',
  'RUNTIME_UI_FREEZE',
  'SESSION_SYNC_FAULT',
  'NETWORK',
]) as Set<string>;

/**
 * Non-bug types that should be excluded from caughtBugs.
 * These are healthy system info logs, not actual bugs.
 */
const NON_BUG_TYPES = new Set([
  'ACTION',
  'HEURISTIC_SCORE',
]) as Set<string>;

/**
 * Check if a bug type is a valid bug that should be counted.
 * For NETWORK type, we only include if status code >= 400.
 */
function isValidBugType(bug: { type?: string; meta?: Record<string, unknown> }): boolean {
  const bugType = bug.type?.toUpperCase();

  // Always exclude non-bug types
  if (bugType && NON_BUG_TYPES.has(bugType)) {
    return false;
  }

  // For NETWORK type, check status code
  if (bugType === 'NETWORK') {
    const statusCode = bug.meta?.statusCode ?? bug.meta?.status;
    if (typeof statusCode === 'number') {
      return (statusCode as number) >= 400;
    }
    // If no status code found, assume it's an unhandled network error
    return true;
  }

  // Include only valid bug types
  return !!(bugType && VALID_BUG_TYPES.has(bugType));
}

/**
 * Convert a raw string to a validated Mongoose ObjectId.
 * Returns null (rather than throwing) so callers can handle the invalid-ID
 * case without try/catch boilerplate at the call site.
 */
function toObjectId(id: string): Types.ObjectId | null {
  if (!isValidObjectId(id)) {
    return null;
  }
  return new Types.ObjectId(id);
}

/**
 * Enforce the 20-step circular-buffer contract at the repository boundary.
 * Any breadcrumb array that arrives with more than 20 entries is trimmed to
 * the 20 most recent steps before the document is written to MongoDB.
 */
function enforceCircularBuffer(steps: string[] | undefined): string[] {
  if (!steps || steps.length === 0) return [];
  return steps.length > 20 ? steps.slice(-20) : steps;
}

// ─────────────────────────────────────────────────────────────────────────────
// SavedSafariRepository
// ─────────────────────────────────────────────────────────────────────────────

export class SavedSafariRepository {
  /**
   * saveSafariRun
   *
   * Flushes a completed (or crashed / halted) exploration run into the
   * 'savedsafaris' collection. Responsibilities:
   *
   *   - Validates that `userId` is a structurally valid ObjectId before write.
   *   - Trims `forensicTrace.finalBreadcrumbSteps` to the 20-step circular
   *     buffer maximum so the validator on the schema never fires in production.
   *   - Auto-generates `bugId` values for any `caughtBugs` entries that arrive
   *     without one (defensive guard — the schema default already handles this
   *     for new sub-documents created through Mongoose, but raw `Partial<>`
   *     data supplied from the engine may bypass it).
   *   - Derives `metrics.totalBugsFound` from `caughtBugs.length` when the
   *     caller does not supply an explicit count, keeping the two fields in sync.
   *
   * @param data  Partial payload from the engine completion handler. Any field
   *              not supplied falls back to the schema default.
   * @returns     The fully hydrated `ISavedSafari` document written to MongoDB.
   * @throws      Error if `userId` is missing or structurally invalid.
   */
  public async saveSafariRun(data: Partial<ISavedSafari>): Promise<ISavedSafari> {
    // ── 1. Validate userId ──────────────────────────────────────────────────
    if (!data.userId) {
      throw new Error('[SavedSafariRepository] saveSafariRun: userId is required.');
    }

    const userObjectId =
      data.userId instanceof Types.ObjectId
        ? data.userId
        : toObjectId(String(data.userId));

    if (!userObjectId) {
      throw new Error(
        `[SavedSafariRepository] saveSafariRun: "${String(data.userId)}" is not a valid ObjectId.`,
);
    }

    // ── 2. Enforce 20-step circular buffer on breadcrumb steps ──────────────
    const safeSteps = enforceCircularBuffer(
      data.forensicTrace?.finalBreadcrumbSteps,
    );

    // ── 3. Guard bugId generation for any sub-documents that lack one ────────
    const safeBugs = (data.forensicTrace?.caughtBugs ?? []).map((bug) => ({
      ...bug,
      bugId: bug.bugId?.trim() || new Types.ObjectId().toString(),
      timestamp: bug.timestamp ?? new Date(),
    }));

    // ── 4. Filter bugs: exclude non-bug types (ACTION, HEURISTIC_SCORE)
    //    Only count actual bugs: EXCEPTION, RUNTIME_UI_FREEZE, SESSION_SYNC_FAULT, NETWORK (status >= 400)
    const filteredBugs = safeBugs.filter(isValidBugType);

    // ── 5. Recalculate bugsByCategory from filtered bugs ─────────────────────
    const recalculatedBugsByCategory: Record<string, number> = {};
    for (const bug of filteredBugs) {
      const category = bug.type || 'UNKNOWN';
      recalculatedBugsByCategory[category] = (recalculatedBugsByCategory[category] || 0) + 1;
    }

    // ── 6. Derive totalBugsFound: use filtered count, not raw count ─────────────
    //    If caller explicitly provided totalBugsFound, trust it was already calculated with filtering,
    //    otherwise derive from filtered bugs
    const derivedTotalBugs =
      data.metrics?.totalBugsFound != null
        ? data.metrics.totalBugsFound
        : filteredBugs.length;

    // ── 7. Compose the write payload ─────────────────────────────────────────
    const writePayload: Partial<ISavedSafari> = {
      ...data,
      userId: userObjectId,
      forensicTrace: {
        finalBreadcrumbSteps: safeSteps,
        caughtBugs: filteredBugs,
      },
      metrics: {
        totalActions: data.metrics?.totalActions ?? 0,
        totalBugsFound: derivedTotalBugs,
        bugsByCategory: recalculatedBugsByCategory,
      },
    };

    // ── 8. Log filtering stats for debugging ────────────────────────────────
    if (safeBugs.length !== filteredBugs.length) {
      console.log(
        `[SavedSafariRepository] Bug filtering: ${safeBugs.length} raw → ${filteredBugs.length} filtered (removed ${safeBugs.length - filteredBugs.length} non-bug entries)`,
      );
    }

    // ── 9. Persist and return the fully hydrated document ────────────────────
    const document = await SavedSafari.create(writePayload);
    return document;
  }

  /**
   * getSafariHistoryByUserId
   *
   * Retrieves all saved safari runs for a given user, sorted newest-first.
   * Populates the `userId` reference so the caller receives the linked User
   * document fields (email, etc.) alongside the safari metrics without a
   * second round-trip.
   *
   * @param userId  The string representation of the user's ObjectId.
   * @returns       Array of populated `ISavedSafari` documents, or [] if the
   *                userId is invalid or no runs exist for that user.
   */
  public async getSafariHistoryByUserId(userId: string): Promise<ISavedSafari[]> {
    // ── 1. Validate userId before hitting the database ───────────────────────
    const userObjectId = toObjectId(userId);
    if (!userObjectId) {
      console.warn(
        `[SavedSafariRepository] getSafariHistoryByUserId: "${userId}" is not a valid ObjectId. Returning [].`,
      );
      return [];
    }

    // ── 2. Query, populate, and sort ─────────────────────────────────────────
    const results = await SavedSafari
      .find({ userId: userObjectId })
      .populate('userId', 'email createdAt') // Pulls selected User fields only
      .sort({ executionDate: -1 })           // Newest safari run first
      .lean<ISavedSafari[]>();               // Return plain JS objects — faster for read-only consumers

    return results;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// Consumers import the shared instance rather than constructing their own,
// keeping the connection pool from being saturated by duplicate instantiation.
// ─────────────────────────────────────────────────────────────────────────────

export const savedSafariRepository = new SavedSafariRepository();