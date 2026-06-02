// Live Feed Component - Light Theme Browser Frame
// Optimized for ClinicalForensicsDashboard integration
// Refactored with fluid responsive layout and aspect-ratio safe constraints

import { useEffect, useRef, useState } from 'react';
import { LiveFeedRenderer } from '../infrastructure/socket/BinaryFrameReceiver';

interface LiveFeedProps {
  frame: string | null;
  isConnected: boolean;
  isTestRunning: boolean;
  currentUrl: string;
  useBinaryStream?: boolean;
  binaryWsUrl?: string;
  hasRunCompleted?: boolean;
  isInitializing?: boolean;
  liveFrame?: string | null;
}

// Native viewport resolution for canvas rendering (internal coordinate system)
// This does NOT dictate display size - only the rendering resolution
const NATIVE_VIEWPORT_WIDTH = 1440;
const NATIVE_VIEWPORT_HEIGHT = 900;

export default function LiveFeed({ 
  frame, 
  isConnected, 
  isTestRunning, 
  currentUrl, 
  useBinaryStream = false,
  binaryWsUrl = 'ws://localhost:8765',
  hasRunCompleted = false,
  isInitializing = false,
  liveFrame = null
}: LiveFeedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LiveFeedRenderer | null>(null);
  const [isBinaryConnected, setIsBinaryConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [canvasStyle, setCanvasStyle] = useState({ width: '100%', height: '100%' });

  // ─────────────────────────────────────────────────────────────
  // DETERMINE STATUS FOR FALLBACK OVERLAYS
  // Status logic: idle (no test run yet) → initializing (test started but no frame) → running/complete
  // ─────────────────────────────────────────────────────────────
  
  // Scene A: If test has not been initialized yet (status === 'idle' and no run completed yet)
  const isIdle = !isTestRunning && !hasRunCompleted && !isInitializing;
  
  // Scene B: If test has been started but initial WebSocket frame packet has not arrived yet
  const isInitializingScreen = isInitializing || (isTestRunning && !liveFrame);
  
  // Scene C: If test concludes normally
  const isCompleted = hasRunCompleted && !isTestRunning;

  // Initialize canvas dimensions on mount and handle responsive resizing
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Set internal canvas resolution (rendering coordinates, not display size)
    canvasRef.current.width = NATIVE_VIEWPORT_WIDTH;
    canvasRef.current.height = NATIVE_VIEWPORT_HEIGHT;
    
    // Handle responsive sizing via ResizeObserver
    const updateCanvasSize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      
      // Calculate display dimensions maintaining aspect ratio
      const sourceAspect = NATIVE_VIEWPORT_WIDTH / NATIVE_VIEWPORT_HEIGHT;
      const containerAspect = containerWidth / containerHeight;
      
      let displayWidth: number;
      let displayHeight: number;
      
      if (containerAspect > sourceAspect) {
        // Container is wider than source - fit by height
        displayHeight = containerHeight;
        displayWidth = containerHeight * sourceAspect;
      } else {
        // Container is taller than source - fit by width
        displayWidth = containerWidth;
        displayHeight = containerWidth / sourceAspect;
      }
      
      setCanvasStyle({
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      });
    };
    
    // Initial measurement
    updateCanvasSize();
    
    // Set up ResizeObserver for responsive updates
    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

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

      const fpsInterval = setInterval(() => {
        const metrics = rendererRef.current?.getMetrics();
        if (metrics) {
          setFps(metrics.avgFrameRate);
        }
      }, 1000);

      setIsBinaryConnected(true);

      return () => {
        clearInterval(fpsInterval);
        rendererRef.current?.destroy();
        rendererRef.current = null;
      };
    } catch (error) {
      console.error('[LiveFeed] Failed to initialize binary renderer:', error);
    }
  }, [useBinaryStream, binaryWsUrl]);

// Render frame: prefer liveFrame for lifecycle control, fallback to frame prop
  // When liveFrame is set, it means the test has started and we have active frames
  // When test concludes, liveFrame is cleared to prevent stale screenshots
  const renderFrame = liveFrame || frame;
  
  useEffect(() => {
    if (renderFrame && !useBinaryStream && canvasRef.current) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, NATIVE_VIEWPORT_WIDTH, NATIVE_VIEWPORT_HEIGHT);
          ctx.drawImage(img, 0, 0, NATIVE_VIEWPORT_WIDTH, NATIVE_VIEWPORT_HEIGHT);
        }
      };
      img.src = renderFrame.startsWith('data:') ? renderFrame : `data:image/jpeg;base64,${renderFrame}`;
    }
  }, [renderFrame, useBinaryStream]);

  return (
    <div className="flex flex-col w-full h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* BROWSER HEADER */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2 sm:px-5 shrink-0">
        {/* Window Controls - 3 small gray dots */}
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-slate-300" aria-hidden="true" />
          <span className="h-3 w-3 rounded-full bg-slate-300" aria-hidden="true" />
          <span className="h-3 w-3 rounded-full bg-slate-300" aria-hidden="true" />
        </div>

        {/* Navigation Buttons (Purely Visual) */}
        <div className="flex items-center gap-3 text-slate-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </div>

        {/* URL BAR - White centered input */}
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-700">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <input
            className="truncate bg-transparent outline-none w-full font-medium text-slate-800"
            readOnly
            value={currentUrl || 'about:blank'}
          />
        </div>


        {/* ENGINE STATUS */}
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isTestRunning ? 'animate-pulse bg-green-500' : isConnected ? 'bg-slate-400' : 'bg-red-500'
            }`}
            aria-hidden="true"
          />
          {isTestRunning ? 'Live' : isConnected ? 'Ready' : 'Offline'}
          {useBinaryStream && isBinaryConnected && (
            <span className="ml-1 text-green-600" title={`Binary: ${fps}fps`}>
              ●
            </span>
          )}
        </div>
      </div>

{/* VIEWPORT - Full fluid expansion with aspect-ratio safe dynamic fitting */}
      <div 
        ref={containerRef}
        className="flex flex-col items-center justify-center flex-1 min-h-0 bg-white overflow-hidden p-0 relative"
      >
        {/* ─────────────────────────────────────────────────────────────
            SCENE A: IDLE - Test has not been initialized yet
            Text constrained to canvas bounds only
        ───────────────────────────────────────────────────────────── */}
        {isIdle && (
          <div 
            className="absolute flex items-center justify-center z-10 bg-white"
            style={{ width: canvasStyle.width, height: canvasStyle.height }}
          >
            <p className="whitespace-pre-wrap px-4 text-center font-mono text-sm tracking-wider uppercase text-zinc-600">
              READY TO INFILTRATE — ENTER TARGET URL TO START SAFARI
            </p>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            SCENE B: INITIALIZING - Test started but no frame received yet
            Text constrained to canvas bounds only
        ───────────────────────────────────────────────────────────── */}
        {isInitializingScreen && (
          <div 
            className="absolute flex flex-col items-center justify-center z-10 bg-white"
            style={{ width: canvasStyle.width, height: canvasStyle.height }}
          >
            <div className="mb-4 flex items-center justify-center gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-600" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-600" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-600" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="whitespace-pre-wrap px-4 text-center font-mono text-sm tracking-wider uppercase text-zinc-600">
              SPINNING UP HEADLESS ENVIRONMENT — ESTABLISHING TELEMETRY STREAM...
            </p>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            SCENE C: COMPLETED - Test concludes normally
            Text constrained to canvas bounds only
        ───────────────────────────────────────────────────────────── */}
        {isCompleted && (
          <div 
            className="absolute flex items-center justify-center z-10 bg-white"
            style={{ width: canvasStyle.width, height: canvasStyle.height }}
          >
            <p className="whitespace-pre-wrap px-4 text-center font-mono text-sm tracking-wider uppercase text-zinc-600">
              EXPLORATION COMPLETE — FORENSIC EVIDENCE COLLECTED. READY FOR NEXT INSTANCE.
            </p>
          </div>
        )}

        {/* Always render canvas - text overlays appear on top when triggered */}
        <canvas
          ref={canvasRef}
          style={{
            width: canvasStyle.width,
            height: canvasStyle.height,
            maxWidth: '100%',
            maxHeight: '100%',
            transform: 'translate3d(0,0,0)',
            backfaceVisibility: 'hidden',
          }}
          className="block object-contain"
        />
      </div>
    </div>
  );
}
