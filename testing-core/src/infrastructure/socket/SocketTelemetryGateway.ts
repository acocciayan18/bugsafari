import type { AccessibilityFinding, DiscoveredElement, ForensicCrashReport, IncidentReport, ReproductionVerdict, TelemetryEvent, TelemetryDeduper, TimeSyncPayload } from '../../../../shared/types.js';
import { ACCESSIBILITY_EVENT, REPRODUCTION_VERDICT_EVENT, TIME_SYNC_EVENT, createTelemetryDeduper } from '../../../../shared/types.js';
import type { BrowserConsoleMessage, TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { scrubCredentials } from '../../domain/services/telemetry/credentialScrub.js';
import { scrubSelectors } from '../../../../shared/reproduction.js';

// Operator-facing free text leaving the engine: credentials the target echoed back
// and any raw DOM path a producer left in a message are both rewritten here, so no
// single emitter can leak either onto the wire, the replay buffer, or storage.
const safeText = (text: string): string => scrubSelectors(scrubCredentials(text));

/** Room-capable event sink. Socket.IO's Server satisfies it, as does the worker's
 *  Redis publisher — so the same gateway drives either transport unchanged. */
export interface RoomEmitter {
  emit(event: string, ...args: unknown[]): unknown;
  to(room: string): { emit(event: string, ...args: unknown[]): unknown };
}

/** Outbound wire channels the recorder buffers for reconnect replay. */
export type TelemetryRecordKind = 'telemetry' | 'url-changed' | 'live-frame' | 'forensic-report' | 'incident-report' | 'accessibility' | 'browser-console' | 'reproduction-verdict';

/** Sink that captures every outbound payload so a returning client can be replayed. */
export interface TelemetryRecorder {
  record(kind: TelemetryRecordKind, payload: unknown): void;
}

export class SocketTelemetryGateway implements TelemetryGateway {
  // Every emit is scoped to this Socket.IO room. Null means no run owns the wire
  // (before reserve, after teardown) and emits are DROPPED — see channel().
  private room: string | null = null;
  private recorder: TelemetryRecorder | null = null;
  private droppedUnrouted = 0;
  // Centralized suppression of consecutive-identical lines and repeat lifecycle
  // handshakes (e.g. duplicate IDLEs). Reset per run so state never leaks across runs.
  private readonly deduper: TelemetryDeduper = createTelemetryDeduper();

  constructor(private readonly io: RoomEmitter) { }

  /** Bind/clear the active run's room (set at run start, cleared at run end). */
  public setRoom(room: string | null): void {
    this.room = room;
    this.deduper.reset();
  }

  /** Bind/clear the ring-buffer recorder for the active run. */
  public setRecorder(recorder: TelemetryRecorder | null): void {
    this.recorder = recorder;
  }

  // Room-scoped emitter, or a sink that drops when no run owns the wire.
  //
  // There is no legitimate fleet-wide audience for a run's telemetry: broadcasting
  // an unrouted emit re-sends one run's frame to EVERY connected dashboard, so a
  // late tail from a finished run lands in another operator's live session — the
  // cross-account leak this replaced. The worker transport already drops these
  // (see RedisTelemetryPublisher.emit); the Socket.IO path now matches it.
  //
  // Nothing is lost for the run's own owner: the room is bound before the
  // start-test response and the owner joins immediately after, and anything
  // emitted in that gap is buffered by the recorder and replayed on attach.
  private channel(): Pick<RoomEmitter, 'emit'> {
    if (this.room) return this.io.to(this.room);
    return { emit: (event: string): boolean => this.dropUnrouted(event) };
  }

  // Rate-limited so a stuck producer cannot write one log line per frame.
  private dropUnrouted(event: string): boolean {
    this.droppedUnrouted += 1;
    if (this.droppedUnrouted === 1 || this.droppedUnrouted % 100 === 0) {
      console.warn(`[SocketTelemetryGateway] dropped unrouted emit '${event}' (no run room bound; ${this.droppedUnrouted} total)`);
    }
    return true;
  }

  public emitTelemetry(event: TelemetryEvent): void {
    // Last line of defense: a target app can echo a submitted credential into an
    // error message that a content scan then lifts into telemetry, and a producer
    // can leave a raw DOM path in one. meta.selector is left intact — it is the
    // internal replay/debug handle, never rendered.
    const safe = event.meta?.message
      ? { ...event, meta: { ...event.meta, message: safeText(event.meta.message) } }
      : event;
    // Suppress redundant lines before they reach the wire, replay buffer, or storage.
    if (!this.deduper.accept(safe)) return;
    this.recorder?.record('telemetry', safe);
    this.channel().emit('telemetry', safe);
  }

  public emitUrlChanged(url: string): void {
    this.recorder?.record('url-changed', url);
    this.channel().emit('url-changed', url);
  }

  // Authoritative timebox clock. Not recorded — the reconnect snapshot already
  // carries the engine's elapsed, so a returning client re-seeds from there.
  public emitTimeSync(payload: TimeSyncPayload): void {
    this.channel().emit(TIME_SYNC_EVENT, payload);
  }

  public emitTargets(targets: DiscoveredElement[]): void {
    this.channel().emit('discovered-elements', targets);
  }

  public emitLiveFrame(base64Jpeg: string): void {
    this.recorder?.record('live-frame', base64Jpeg);
    this.channel().emit('live-frame', base64Jpeg);
  }

  public emitForensicReport(raw: ForensicCrashReport): void {
    const report = this.sanitizeNarrative(raw);
    this.recorder?.record('forensic-report', report);
    this.channel().emit('forensic-report', report);
    this.emitIncidentReport({
      timestamp: report.timestamp,
      reason: report.reason,
      statusCode: report.statusCode,
      url: report.url,
      stackTrace: report.stackTrace,
      steps: report.breadcrumbs.map((item) => ({
        timestamp: item.timestamp,
        type: item.action.includes('input') ? 'INPUT' : item.action.includes('hover') ? 'HOVER' : 'CLICK',
        selector: item.selector,
        url: report.url,
        payload: item.payload,
      })),
      // Forward the frozen steps + remediation + classification so the synthesized
      // incident is a FULL copy. Omitting attribution/severity/culprit here degraded
      // it: this incident arrives after the real one and wins the frontend collapse,
      // stripping the bug class + severity + culprit from the saved finding.
      reproductionPlaybook: report.reproductionPlaybook,
      advice: report.advice,
      attribution: report.attribution,
      severity: report.severity,
      culpritSelector: report.culpritSelector,
      culpritLabel: report.culpritLabel,
    });
  }

  public emitIncidentReport(raw: IncidentReport): void {
    const report = this.sanitizeNarrative(raw);
    this.recorder?.record('incident-report', report);
    this.channel().emit('incident-report', report);
  }

  // Scrub the operator-facing narrative of a finding (fault text + playbook).
  // Structural fields (culpritSelector, per-step selectors) stay raw — they drive
  // Verify Fix replay and are never rendered.
  private sanitizeNarrative<T extends { reason: string; reproductionPlaybook?: string[] }>(report: T): T {
    return {
      ...report,
      reason: safeText(report.reason),
      reproductionPlaybook: report.reproductionPlaybook?.map(safeText),
    };
  }

  // Buffered: the verdict lands seconds after its finding, so a client that
  // reconnects in between must still receive the patch on replay.
  public emitReproductionVerdict(verdict: ReproductionVerdict): void {
    this.recorder?.record('reproduction-verdict', verdict);
    this.channel().emit(REPRODUCTION_VERDICT_EVENT, verdict);
  }

  // WCAG findings ride their own channel so the dashboard's Accessibility tab
  // listens in isolation — never mixed into the generic Error/telemetry streams.
  public emitAccessibility(finding: AccessibilityFinding): void {
    this.recorder?.record('accessibility', finding);
    this.channel().emit(ACCESSIBILITY_EVENT, finding);
  }

  // Buffered like the other channels so a reconnect/restore replays the Console tab
  // instead of losing every row captured before the drop.
  public emitBrowserConsole(message: BrowserConsoleMessage): void {
    this.recorder?.record('browser-console', message);
    this.channel().emit('browser-console', message);
  }
}
