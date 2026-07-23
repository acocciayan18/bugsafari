// Live Feed Component - INDUSTRIAL VIEWPORT
// High-contrast brutalist technical aesthetic
// Dark container for canvas streaming

import { memo, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, MoreVertical } from 'lucide-react';
import { LiveFeedRenderer } from '../../infrastructure/socket/BinaryFrameReceiver';
import { normalizeTargetUrl } from '../../../../shared/url.js';
import type { RunTerminationOutcome } from '../../types';
import { TERMINATION_COPY } from '../../types';

interface LiveFeedProps {
  frame: string | null;
  currentUrl?: string;
  targetUrl?: string;
  isConnected?: boolean;
  isTestRunning: boolean;
  isQueued?: boolean;
  useBinaryStream?: boolean;
  binaryWsUrl?: string;
  hasRunCompleted?: boolean;
  isInitializing?: boolean;
  liveFrame?: string | null;
  /** Why the run ended — drives the terminal overlay copy. */
  terminationOutcome?: RunTerminationOutcome | null;
}

// Native viewport resolution for canvas rendering
const NATIVE_VIEWPORT_WIDTH = 1440;
const NATIVE_VIEWPORT_HEIGHT = 900;

function LiveFeed({
  frame,
  currentUrl,
  targetUrl,
  isTestRunning,
  isQueued = false,
  useBinaryStream = false,
  binaryWsUrl = 'ws://localhost:8765',
  hasRunCompleted = false,
  isInitializing = false,
  liveFrame = null,
  terminationOutcome = null
}: LiveFeedProps) {
  const terminationCopy = terminationOutcome ? TERMINATION_COPY[terminationOutcome] : null;
  // Show the address the engine actually resolves to, not the raw typed input.
  const rawUrl = currentUrl || targetUrl || '';
  const displayUrl = normalizeTargetUrl(rawUrl) ?? rawUrl;
  const isSecureUrl = displayUrl.startsWith('https://');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LiveFeedRenderer | null>(null);
  // One reused decoder + a generation counter so an older frame's late decode can
  // never paint over a newer one, and a pending decode is dropped on unmount.
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameGenRef = useRef(0);

  // Status determination — QUEUED holds a dedicated standby screen and suppresses
  // the initializing/idle states so the viewport never reads as "streaming" while
  // the run is still waiting for a worker.
  const isIdle = !isTestRunning && !hasRunCompleted && !isInitializing && !isQueued;
  const isInitializingScreen = !isQueued && (isInitializing || (isTestRunning && !liveFrame));
  const isCompleted = hasRunCompleted && !isTestRunning;

// Calculate optimal dimensions for object-fit: cover (no empty margins, cropping allowed)
  const calculateCoverDimensions = useCallback(() => {
    if (!containerRef.current) {
      return { 
        canvasWidth: NATIVE_VIEWPORT_WIDTH, 
        canvasHeight: NATIVE_VIEWPORT_HEIGHT,
        scale: 1
      };
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    // Calculate scale for object-fit: cover behavior
    // Use Math.max to ensure image covers ENTIRE container (no whitespace)
    // This means the image will overflow/crop if aspect ratios don't match
    const scale = Math.max(
      containerWidth / NATIVE_VIEWPORT_WIDTH,
      containerHeight / NATIVE_VIEWPORT_HEIGHT
    );

    // Calculate scaled dimensions - these become canvas INTERNAL resolution
    const canvasWidth = Math.round(NATIVE_VIEWPORT_WIDTH * scale);
    const canvasHeight = Math.round(NATIVE_VIEWPORT_HEIGHT * scale);

    return {
      canvasWidth,
      canvasHeight,
      scale
    };
  }, []);

// Update canvas for object-fit: cover rendering
  const updateCanvasSize = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const coverData = calculateCoverDimensions();

    // Set canvas INTERNAL resolution to scaled dimensions
    // This implements object-fit: cover - the image fills the canvas without stretching
    canvasRef.current.width = coverData.canvasWidth;
    canvasRef.current.height = coverData.canvasHeight;
  }, [calculateCoverDimensions]);

  // Initialize canvas dimensions with object-fit: cover
  useEffect(() => {
    if (!canvasRef.current) return;

    updateCanvasSize();

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateCanvasSize]);

  // Binary stream handling
  useEffect(() => {
    if (!useBinaryStream || !canvasRef.current || rendererRef.current) {
      return;
    }

    try {
      rendererRef.current = new LiveFeedRenderer({
        canvasElement: canvasRef.current,
        wsUrl: binaryWsUrl,
        frameWidth: NATIVE_VIEWPORT_WIDTH,
        frameHeight: NATIVE_VIEWPORT_HEIGHT,
      });

      rendererRef.current.connect();
      rendererRef.current.start();

      return () => {
        rendererRef.current?.destroy();
        rendererRef.current = null;
      };
    } catch (error) {
      console.error('[LiveFeed] Failed to initialize binary renderer:', error);
    }
  }, [useBinaryStream, binaryWsUrl]);

// Frame rendering - uses object-fit: cover (fills canvas, cropped if needed)
  const renderFrame = liveFrame || frame;

  useEffect(() => {
    if (!renderFrame || useBinaryStream || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Tag this decode; only the latest generation is allowed to paint.
    const generation = ++frameGenRef.current;
    const img = imageRef.current ?? (imageRef.current = new Image());
    img.onload = () => {
      // A newer frame superseded this one, or the canvas unmounted — drop the paint.
      if (generation !== frameGenRef.current || !canvasRef.current) return;
      // Draw image to fill canvas (object-fit: cover behavior); canvas internal
      // resolution is already set to cover dimensions.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = renderFrame.startsWith('data:') ? renderFrame : `data:image/jpeg;base64,${renderFrame}`;

    return () => { img.onload = null; };
  }, [renderFrame, useBinaryStream]);

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-(--surface-panel) shadow-md rounded-md border border-(--border-hairline)">

      {/* BROWSER CHROME - decorative toolbar, no interaction */}
      <div className="flex items-center gap-1.5 border-b border-(--border-hairline) bg-(--surface-app) px-2 py-2 shrink-0 rounded-t-md sm:gap-2 sm:px-3">
        {/* LEFT: nav controls (decorative) — arrows drop first, they carry no meaning here */}
        <div className="flex shrink-0 items-center gap-1 text-(--text-tertiary)">
          <span className="hidden p-1 opacity-40 cursor-default sm:inline" aria-hidden="true"><ArrowLeft size={14} /></span>
          <span className="hidden p-1 opacity-40 cursor-default sm:inline" aria-hidden="true"><ArrowRight size={14} /></span>
          <span className="p-1 opacity-70 cursor-default" aria-hidden="true"><RotateCw size={13} /></span>
        </div>

        {/* CENTER: URL bar */}
        <div className="flex flex-1 items-center gap-1.5 min-w-0 mx-1 bg-(--surface-panel) rounded-full px-2.5 py-1 text-[13px] text-(--text-secondary) shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] border border-(--border-hairline) sm:mx-2 sm:px-3">
          {isSecureUrl ? (
            <Lock size={11} className="shrink-0 text-(--text-tertiary)" aria-hidden="true" />
          ) : (
            <Globe size={11} className="shrink-0 text-(--text-tertiary)" aria-hidden="true" />
          )}
          <span className="truncate font-mono">{displayUrl || 'about:blank'}</span>
        </div>

        {/* RIGHT: status + three-dot menu (decorative) */}
        <div className="flex items-center gap-1.5 shrink-0 sm:gap-2">
          {isQueued && (
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-mono text-(--status-neutral-fg) sm:text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 bg-(--status-neutral-fg) rounded-full animate-pulse sm:h-3 sm:w-3"></span>
              QUEUED
            </span>
          )}

          {!isQueued && !isTestRunning && !useBinaryStream && (
            <span className="whitespace-nowrap text-[11px] text-(--text-tertiary) sm:text-[13px]">Ready</span>
          )}

          <span className="hidden p-1 opacity-70 cursor-default text-(--text-tertiary) sm:inline" aria-hidden="true">
            <MoreVertical size={14} />
          </span>
        </div>
      </div>

{/* CANVAS CONTAINER - White Industrial */}
      <div
        ref={containerRef}
        className="flex flex-col items-center justify-center flex-1 min-h-0 bg-(--surface-panel) overflow-hidden p-0 relative"
      >
        {/* Overlays fill the container, not the cover-scaled canvas resolution, which overflows it. */}
        {/* IDLE STATE */}
        {isIdle && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-(--surface-panel) px-4 text-center">
            <p className="font-mono text-[11px] sm:text-sm tracking-[0.15em] sm:tracking-[0.3em] uppercase text-(--text-primary)">
              ENTER TARGET URL TO INITIATE
            </p>
          </div>
        )}

        {/* QUEUED STANDBY STATE — run parked behind the worker fleet; no stream yet. */}
        {isQueued && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-(--surface-panel) px-4 text-center">
            <span className="mb-4 inline-block h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-(--status-neutral-fg) border-r-transparent"></span>
            <p className="font-mono text-[11px] sm:text-sm tracking-[0.15em] sm:tracking-[0.3em] uppercase text-(--text-primary)">
              QUEUED — AWAITING WORKER FLEET
            </p>
          </div>
        )}

        {/* INITIALIZING STATE */}
        {isInitializingScreen && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-(--surface-panel) px-4 text-center">
            <div className="mb-4 flex items-center justify-center gap-1">
              <span className="h-3 w-3 bg-(--text-primary) animate-pulse"></span>
              <span className="h-3 w-3 bg-(--text-primary) animate-pulse" style={{ animationDelay: '150ms' }}></span>
              <span className="h-3 w-3 bg-(--text-primary) animate-pulse" style={{ animationDelay: '300ms' }}></span>
            </div>
            <p className="font-mono text-[11px] sm:text-sm tracking-[0.15em] sm:tracking-[0.3em] uppercase text-(--text-primary)">
              ESTABLISHING TELEMETRY STREAM
            </p>
          </div>
        )}

        {/* COMPLETED STATE */}
        {isCompleted && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 overflow-y-auto bg-(--surface-panel) px-4 py-3 text-center sm:px-6">
            <p className="font-mono text-[11px] sm:text-sm tracking-[0.15em] sm:tracking-[0.3em] uppercase text-(--text-primary)">
              {terminationCopy?.label ?? 'Exploration Complete'}
            </p>
            <p className="max-w-md text-[13px] text-(--text-secondary)">
              {terminationCopy?.detail ?? 'Exploration finished.'}
            </p>
          </div>
        )}

{/* Canvas with object-fit: cover (internal resolution = display size) */}
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
        />
      </div>
    </div>
  );
}

// Memoized so a telemetry-only store change (no frame/url/status change) can't
// re-run the canvas draw — the frame path is isolated from the log render storm.
export default memo(LiveFeed);
