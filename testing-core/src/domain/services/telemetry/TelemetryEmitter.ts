import type { Page } from 'playwright';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';
import type { TelemetryEvent } from '../../../../../shared/types.ts';
import type { TelemetryEmitterFlags } from '../exploration/types.js';
import { isBrowserClosedError } from './StabilityMonitor.js';

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

  // Independent frame capture loop state
  private page: Page | null = null;
  private frameCaptureInterval: ReturnType<typeof setInterval> | null = null;
  private isFrameBroadcastInFlight = false;

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

  /** Capture and broadcast a single live frame (used inline by the step loop). */
  public emitLiveFrame(page: Page): Promise<void> {
    return this.broadcastFrame(page);
  }

  public startFrameCaptureLoop(page: Page): void {
    this.page = page;

    // 🚀 Start the independent 33 ms frame loop the instant the page object
    // exists — BEFORE page.goto. The page is at about:blank, so screenshots
    // succeed and emit valid (blank) JPEGs immediately, clearing the dashboard's
    // 30 s "no live frame" handshake within ~33 ms regardless of how long — or
    // whether — navigation succeeds. broadcastFrame guards page.isClosed()/in-flight
    // and each screenshot is capped by SCREENSHOT_TIMEOUT_MS, so ticking
    // before/during goto is safe. The loop begins streaming the painted page
    // automatically once goto completes.
    this.frameCaptureInterval = setInterval(async () => {
      if (!this.page || this.flags.isStopRequested() || this.flags.isPaused()) {
        return;
      }
      await this.broadcastFrame(this.page);
    }, 33);
  }

  public stopFrameCaptureLoop(): void {
    if (this.frameCaptureInterval) {
      clearInterval(this.frameCaptureInterval);
      this.frameCaptureInterval = null;
    }
    this.page = null;
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

      if (this.gateway.emitLiveFrameBinary) {
        this.gateway.emitLiveFrameBinary(screenshot);
      } else {
        this.gateway.emitLiveFrame(screenshot.toString('base64'));
      }
    } catch (err) {
      if (isBrowserClosedError(err)) {
        return;
      }
      console.warn('[TelemetryEmitter] Frame capture failed:', err instanceof Error ? err.message : err);
    } finally {
      this.isFrameBroadcastInFlight = false;
    }
  }
}
