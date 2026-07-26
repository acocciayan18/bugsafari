import type { AccessibilityFinding, DiscoveredElement, ForensicCrashReport, IncidentReport, ReproductionVerdict, TelemetryEvent, TelemetryDeduper } from '../../../../shared/types.js';
import { ACCESSIBILITY_EVENT, REPRODUCTION_VERDICT_EVENT, createTelemetryDeduper } from '../../../../shared/types.js';
import type { BrowserConsoleMessage, TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { scrubCredentials } from '../../domain/services/telemetry/credentialScrub.js';

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
  // When set, emits are scoped to this Socket.IO room instead of broadcast to
  // every connected socket — the run-scoped wire that makes future per-tenant
  // isolation a config change rather than a rewrite. Null preserves the legacy
  // broadcast behavior (no active run).
  private room: string | null = null;
  private recorder: TelemetryRecorder | null = null;
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

  // Room-scoped emitter when a run owns the wire, otherwise a plain broadcast.
  private channel(): Pick<RoomEmitter, 'emit'> {
    return this.room ? this.io.to(this.room) : this.io;
  }

  public emitTelemetry(event: TelemetryEvent): void {
    // Last line of defense: a target app can echo a submitted credential into an
    // error message that a content scan then lifts into telemetry.
    const safe = event.meta?.message
      ? { ...event, meta: { ...event.meta, message: scrubCredentials(event.meta.message) } }
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

  public emitTargets(targets: DiscoveredElement[]): void {
    this.channel().emit('discovered-elements', targets);
  }

  public emitLiveFrame(base64Jpeg: string): void {
    this.recorder?.record('live-frame', base64Jpeg);
    this.channel().emit('live-frame', base64Jpeg);
  }

  public emitForensicReport(report: ForensicCrashReport): void {
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
    });
  }

  public emitIncidentReport(report: IncidentReport): void {
    this.recorder?.record('incident-report', report);
    this.channel().emit('incident-report', report);
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
