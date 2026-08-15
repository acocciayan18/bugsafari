// Soft-delete lifecycle helpers — the single source of truth for how archivedAt/
// deletedAt map to the Active/Archived/Trash history buckets. Shared by the repo
// list query and the route handlers so the semantics can never drift between them.
import type { SessionHistoryState } from '../../../../shared/types.js';

// Mongo filter fragment selecting one bucket. Equality-to-null matches both null
// and a missing field, so legacy docs (which have neither tombstone) read as active.
export function sessionStateFilter(state: SessionHistoryState): Record<string, unknown> {
  switch (state) {
    case 'archived': return { archivedAt: { $ne: null }, deletedAt: null };
    case 'trashed':  return { deletedAt: { $ne: null } };
    case 'active':
    default:         return { archivedAt: null, deletedAt: null };
  }
}

// Which bucket a persisted doc currently sits in. Trash wins over archive so a
// row archived then trashed reports as trashed.
export function sessionHistoryState(
  doc: { archivedAt?: Date | null; deletedAt?: Date | null },
): SessionHistoryState {
  if (doc.deletedAt) return 'trashed';
  if (doc.archivedAt) return 'archived';
  return 'active';
}
