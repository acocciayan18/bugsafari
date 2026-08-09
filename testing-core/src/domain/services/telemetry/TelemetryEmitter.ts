import type { CDPSession, Frame, Page } from 'playwright';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';
import type { AccessibilityFinding, TelemetryEvent } from '../../../../../shared/types.js';
import type { TelemetryEmitterFlags } from '../exploration/types.js';
import { isBrowserClosedError } from './StabilityMonitor.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';
import { incCounter } from '../../../infrastructure/observability/metrics.js';

const obsLog = createLogger('[TelemetryEmitter]');

// Env-tunable positive integer with a safe fallback. Lets the screencast be retuned
// per deployment without a rebuild — the feed is operator observability, not a
// recording, so a constrained box can trade fidelity for CPU/bandwidth.
function readEnvInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Manages Socket.IO / HTTP cross-boundary telemetry transmissions for the
 * exploration engine: the canonical TelemetryEvent factory, milestone/system
 * status helpers, and the independent ~33ms live-frame capture loop that streams
 * base64/binary JPEG frames to the Watchtower dashboard.
 */
export class TelemetryEmitter {
  // Hard upper bound for a single screenshot capture.
  // Playwright's default can hang 20-25 s on a cold page; 5 s is ample for
  // a live-stream frame and prevents blocking the 30-second init window.
  private static readonly SCREENSHOT_TIMEOUT_MS = 5000;

  // CDP screencast tuning. Frames are browser-pushed (not pulled), so the cost per
  // frame is a fraction of a page.screenshot() round-trip, and delivery is decoupled
  // from the exploration's own protocol traffic. maxWidth/maxHeight downscale from
  // the 1440x900 viewport server-side, shrinking each JPEG for faster transfer/decode.
  // Env-overridable so a constrained box can trade feed fidelity for CPU/bandwidth
  // (this is operator observability, not a recording). Code defaults preserve the
  // historical feed; production sets the retuned values via compose env — see
  // BUGSAFARI_SCREENCAST_* in docker-compose.prod.yml.
  private static readonly SCREENCAST_QUALITY = readEnvInt('BUGSAFARI_SCREENCAST_QUALITY', 40);
  private static readonly SCREENCAST_MAX_WIDTH = readEnvInt('BUGSAFARI_SCREENCAST_MAX_WIDTH', 1280);
  private static readonly SCREENCAST_MAX_HEIGHT = readEnvInt('BUGSAFARI_SCREENCAST_MAX_HEIGHT', 800);
  // Cap the live feed. Chrome holds the next frame until we ack, so pacing the ack
  // throttles capture at the source — no wasted encoding, and the feed can't outrun
  // the dashboard and build a stale backlog (the "delay" on heavy pages).
  private static readonly SCREENCAST_MAX_FPS = readEnvInt('BUGSAFARI_SCREENCAST_MAX_FPS', 30);
  private static readonly SCREENCAST_MIN_INTERVAL_MS = Math.round(1000 / TelemetryEmitter.SCREENCAST_MAX_FPS);
  // No frame for this long while streaming ⇒ the screencast stalled (Chrome stops it
  // on navigation, or a cross-process target swap). Re-arm and push a current-page
  // screenshot so the feed never freezes on the previous URL.
  private static readonly SCREENCAST_STALL_MS = 1000;

  // Independent frame capture state
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private screencastActive = false;
  private lastFrameEmitMs = 0;
  private pendingFrame: { session: CDPSession; sessionId: number; data: string } | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private navHandler: ((frame: Frame) => void) | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  // Legacy fallback loop (used only when a CDP screencast cannot be started).
  private frameCaptureInterval: ReturnType<typeof setInterval> | null = null;
  private isFrameBroadcastInFlight = false;
  // One-shot log the first time a frame reaches the gateway — pairs with the
  // dashboard's "first live-frame received" to localize a white feed to the exact
  // half (engine not emitting vs client not painting) that broke.
  private firstFrameLogged = false;

  constructor(
    public readonly gateway: TelemetryGateway,
    private readonly flags: TelemetryEmitterFlags,
  ) {}

  /** Build the canonical TelemetryEvent envelope. */
  public event(type: TelemetryEvent['type'], meta: TelemetryEvent['meta']): TelemetryEvent {
    return {
      timestamp: new Date().toISOString(),
      type,
      meta,
    };
  }

  /** Convenience: build and emit a telemetry event in one call. */
  public emit(type: TelemetryEvent['type'], meta: TelemetryEvent['meta']): void {
    this.gateway.emitTelemetry(this.event(type, meta));
  }

  /** Stream a WCAG finding on the dedicated accessibility channel. */
  public emitAccessibility(finding: AccessibilityFinding): void {
    this.gateway.emitAccessibility(finding);
  }

  public emitMilestone(message: string): void {
    this.gateway.emitTelemetry(
      this.event('ACTION', {
        actionExecuted: 'engine-milestone',
        message,
      }),
    );
  }

  /**
   * Emit granular system status for dynamic UI (Task 3).
   * Sends specific status updates like "Navigating to URL...", "Hashing DOM state...", etc.
   */
  public emitSystemStatus(status: string): void {
    this.gateway.emitTelemetry(
      this.event('ACTION', {
        actionExecuted: 'system-status',
        message: status,
      }),
    );
  }

  /**
   * On-demand single frame from the step loop. The screencast already streams
   * continuously, so this is a no-op while it is active — avoiding a redundant
   * screenshot pull that would compete with the exploration's protocol traffic.
   * Falls back to a one-off screenshot only when the stream is unavailable.
   */
  public emitLiveFrame(page: Page): Promise<void> {
    if (this.screencastActive) return Promise.resolve();
    return this.broadcastFrame(page);
  }

  /**
   * Begin streaming live frames. Prefers a CDP screencast — the browser pushes JPEG
   * frames on paint, each acked to release the next (natural backpressure), fully
   * decoupled from the exploration's own page.evaluate/click traffic on the same
   * page. Falls back to the legacy pulled-screenshot loop if the session can't start.
   */
  public startFrameCaptureLoop(page: Page): void {
    this.page = page;
    void this.startScreencast(page);
  }

  private screencastParams(): Record<string, unknown> {
    return {
      format: 'jpeg',
      quality: TelemetryEmitter.SCREENCAST_QUALITY,
      maxWidth: TelemetryEmitter.SCREENCAST_MAX_WIDTH,
      maxHeight: TelemetryEmitter.SCREENCAST_MAX_HEIGHT,
      everyNthFrame: 1,
    };
  }

  private async startScreencast(page: Page): Promise<void> {
    try {
      const session = await page.context().newCDPSession(page);
      // A stopFrameCaptureLoop() or a newer start (tab switch) may have raced while
      // we awaited the session — abandon this one so we don't stream a stale page.
      if (this.page !== page) {
        await session.detach().catch(() => undefined);
        return;
      }
      session.on('Page.screencastFrame', (frame) =>
        this.onScreencastFrame(session, frame as { data: string; sessionId: number }),
      );
      // Begins at about:blank (BEFORE goto), so a blank frame clears the dashboard's
      // 30 s "no live frame" handshake within a few ms, then streams the painted page
      // the instant navigation completes.
      await session.send('Page.startScreencast', this.screencastParams());
      // Re-check after the await: a stop/tab-switch may have raced during startScreencast.
      if (this.page !== page) {
        await session.send('Page.stopScreencast').catch(() => undefined);
        await session.detach().catch(() => undefined);
        return;
      }
      this.cdpSession = session;
      this.screencastActive = true;
      this.lastFrameEmitMs = Date.now();
      obsLog.info('[TelemetryEmitter] CDP screencast active — streaming live frames.');
      // Chrome STOPS the screencast on navigation, so re-arm it the instant the main
      // frame commits a new document — otherwise the feed freezes on the old URL.
      this.navHandler = (frame) => {
        if (this.page === page && frame === page.mainFrame()) void this.rearmScreencast();
      };
      page.on('framenavigated', this.navHandler);
      this.startWatchdog(page);
    } catch (err) {
      if (isBrowserClosedError(err)) return;
      obsLog.warn(
        '[TelemetryEmitter] CDP screencast unavailable, falling back to screenshot loop:',
        err instanceof Error ? err.message : err,
      );
      this.startScreenshotLoop(page);
    }
  }

  /** Re-issue startScreencast on the live session — resumes the stream Chrome stopped
   *  on navigation. A throw means the session died; the watchdog keeps the feed alive. */
  private async rearmScreencast(): Promise<void> {
    const session = this.cdpSession;
    if (!session || !this.screencastActive) return;
    try {
      await session.send('Page.startScreencast', this.screencastParams());
    } catch {
      /* session gone — watchdog screenshot fallback covers it */
    }
  }

  /** Safety net: if no frame has arrived for SCREENCAST_STALL_MS while streaming, the
   *  screencast silently stopped (a navigation the event missed, a target swap). Re-arm
   *  it AND push one current-page screenshot so the operator always sees the live URL. */
  private startWatchdog(page: Page): void {
    this.watchdog = setInterval(() => {
      if (!this.screencastActive || this.page !== page || this.flags.isPaused() || this.flags.isStopRequested()) {
        return;
      }
      if (Date.now() - this.lastFrameEmitMs < TelemetryEmitter.SCREENCAST_STALL_MS) return;
      this.lastFrameEmitMs = Date.now(); // pace the fallback so a dead stream shows ~1 fps, not a flood
      void this.rearmScreencast();
      void this.broadcastFrame(page);
    }, TelemetryEmitter.SCREENCAST_STALL_MS);
    // unref so a teardown-bypass path can't leave this interval pinning the event loop.
    this.watchdog.unref();
  }

  private onScreencastFrame(session: CDPSession, frame: { data: string; sessionId: number }): void {
    // Pace delivery to SCREENCAST_MAX_FPS. Only one frame is ever in flight (Chrome
    // waits for our ack), so if the last emit was under the frame interval ago we
    // hold this frame and ack it when the interval elapses — capping fps without
    // dropping to a stale backlog. Otherwise deliver straight through.
    const sinceLast = Date.now() - this.lastFrameEmitMs;
    if (sinceLast >= TelemetryEmitter.SCREENCAST_MIN_INTERVAL_MS) {
      this.deliverFrame(session, frame);
      return;
    }
    // A frame already held here never ships — pacing coalesces it into this newer one.
    if (this.pendingFrame) incCounter('bugsafari_screencast_frames_dropped_total', 'Screencast frames coalesced/dropped by fps pacing.');
    incCounter('bugsafari_screencast_frames_paced_total', 'Screencast frames held to honor the fps cap.');
    this.pendingFrame = { session, sessionId: frame.sessionId, data: frame.data };
    if (!this.ackTimer) {
      this.ackTimer = setTimeout(() => {
        this.ackTimer = null;
        const p = this.pendingFrame;
        this.pendingFrame = null;
        if (p) this.deliverFrame(p.session, { data: p.data, sessionId: p.sessionId });
      }, TelemetryEmitter.SCREENCAST_MIN_INTERVAL_MS - sinceLast);
    }
  }

  private deliverFrame(session: CDPSession, frame: { data: string; sessionId: number }): void {
    this.lastFrameEmitMs = Date.now();
    incCounter('bugsafari_screencast_frames_emitted_total', 'Screencast frames delivered to the gateway.');
    // Ack releases Chrome to capture the next paint — the ack IS the backpressure
    // release. A failed ack means the target/session is gone; safe to ignore.
    session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
    if (this.flags.isStopRequested() || this.flags.isPaused()) return;
    this.noteFrameEmitted();
    if (this.gateway.emitLiveFrameBinary) {
      this.gateway.emitLiveFrameBinary(Buffer.from(frame.data, 'base64'));
    } else {
      this.gateway.emitLiveFrame(frame.data); // CDP frame.data is already base64 JPEG
    }
  }

  // Log the first frame handed to the gateway so a white feed is trivially bisected.
  private noteFrameEmitted(): void {
    if (this.firstFrameLogged) return;
    this.firstFrameLogged = true;
    obsLog.info('[TelemetryEmitter] first live frame emitted to gateway.');
  }

  /** Legacy fallback: pull a JPEG screenshot every 33 ms. Only used when a CDP
   *  screencast could not be started (non-Chromium context, session failure). */
  private startScreenshotLoop(page: Page): void {
    this.frameCaptureInterval = setInterval(async () => {
      if (!this.page || this.flags.isStopRequested() || this.flags.isPaused()) {
        return;
      }
      await this.broadcastFrame(this.page);
    }, 33);
    // unref so a teardown-bypass path can't leave this interval pinning the event loop.
    this.frameCaptureInterval.unref();
  }

  public stopFrameCaptureLoop(): void {
    const page = this.page;
    this.page = null;
    this.screencastActive = false;
    if (this.navHandler && page) {
      page.off('framenavigated', this.navHandler);
    }
    this.navHandler = null;
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
    this.pendingFrame = null;
    this.lastFrameEmitMs = 0;
    const session = this.cdpSession;
    this.cdpSession = null;
    if (session) {
      // Stop + detach off the hot path; both throw if the target is already gone.
      void (async () => {
        try { await session.send('Page.stopScreencast'); } catch { /* target closed */ }
        try { await session.detach(); } catch { /* already detached */ }
      })();
    }
    if (this.frameCaptureInterval) {
      clearInterval(this.frameCaptureInterval);
      this.frameCaptureInterval = null;
    }
  }

  private async broadcastFrame(page: Page): Promise<void> {
    if (this.isFrameBroadcastInFlight) {
      return;
    }
    if (page.isClosed()) {
      return;
    }
    this.isFrameBroadcastInFlight = true;

    try {
      const screenshot = await Promise.race([
        page.screenshot({ type: 'jpeg', quality: 35 }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('[Frame] Screenshot timed out')),
            TelemetryEmitter.SCREENSHOT_TIMEOUT_MS,
          )
        ),
      ]);

      this.noteFrameEmitted();
      if (this.gateway.emitLiveFrameBinary) {
        this.gateway.emitLiveFrameBinary(screenshot);
      } else {
        this.gateway.emitLiveFrame(screenshot.toString('base64'));
      }
    } catch (err) {
      if (isBrowserClosedError(err)) {
        return;
      }
      obsLog.warn('[TelemetryEmitter] Frame capture failed:', err instanceof Error ? err.message : err);
    } finally {
      this.isFrameBroadcastInFlight = false;
    }
  }
}
