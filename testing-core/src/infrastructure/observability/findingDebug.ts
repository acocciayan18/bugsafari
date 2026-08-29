// TEMPORARY diagnostic — gated by BUGSAFARI_DEBUG_FINDINGS. Logs the identity of every
// finding that becomes a live card (gateway emit) or a ledger entry (registerConfirmedBug),
// so two distinct bugIds/signatures for one physical crash can be told apart and the second
// emission source pinned. Remove once the duplicate-source investigation is closed.

import { buildFaultSignature, faultStackTop } from '../../../../shared/faultSignature.js';
import type { Logger } from './logger.js';

export interface FindingIdentityInput {
  bugId?: string;
  reason?: string;
  url?: string;
  stackTrace?: string;
  statusCode?: number;
  occurrences?: number;
  type?: string;
  source?: string;
}

const enabled = (): boolean =>
  process.env.BUGSAFARI_DEBUG_FINDINGS === '1' || process.env.BUGSAFARI_DEBUG_FINDINGS === 'true';

export function logFindingIdentity(logger: Logger, event: string, f: FindingIdentityInput): void {
  if (!enabled()) return;
  logger.warn('[finding-debug]', {
    event,
    bugId: f.bugId ?? '',
    type: f.type,
    source: f.source,
    occurrences: f.occurrences ?? 1,
    signature: buildFaultSignature({ reason: f.reason, url: f.url, stackTrace: f.stackTrace, statusCode: f.statusCode }),
    stackTop: faultStackTop(f.stackTrace),
    message: (f.reason ?? '').slice(0, 120),
  });
}
