// Live Feed Component - INDUSTRIAL VIEWPORT
// High-contrast brutalist technical aesthetic
// Dark container for canvas streaming

import { useEffect, useRef, useState } from 'react';
import { LiveFeedRenderer } from '../infrastructure/socket/BinaryFrameReceiver';

interface LiveFeedProps {
  frame: string | null;
  currentUrl?: string;
  targetUrl?: string;
  isConnected?: boolean;
  isTestRunning: boolean;
  useBinaryStream?: boolean;
  binaryWsUrl?: string;
  hasRunCompleted?: boolean;
  isInitializing?: boolean;
  liveFrame?: string | null;
}

// Native viewport resolution for canvas rendering
const NATIVE_VIEWPORT_WIDTH = 1440;
const NATIVE_VIEWPORT_HEIGHT = 900;

export default function LiveFeed({
  frame,
  currentUrl,
  targetUrl,
  isTestRunning,
  useBinaryStream = false,
  binaryWsUrl = 'ws://localhost:8765',
  hasRunCompleted = false,
  isInitializing = false,
  liveFrame = null
}: LiveFeedProps) {
  const displayUrl = currentUrl || targetUrl || '';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LiveFeedRenderer | null>(null);
  const [fps, setFps] = useState(0);
  const [canvasStyle, setCanvasStyle] = useState({ width: '100%', height: '100%' });

  // Status determination
  const isIdle = !isTestRunning && !hasRunCompleted && !isInitializing;
  const isInitializingScreen = isInitializing || (isTestRunning && !liveFrame);
  const isCompleted = hasRunCompleted && !isTestRunning;

  // Initialize canvas dimensions
  useEffect(() => {
    if (!canvasRef.current) return;

    canvasRef.current.width = NATIVE_VIEWPORT_WIDTH;
    canvasRef.current.height = NATIVE_VIEWPORT_HEIGHT;

    const updateCanvasSize = () => {
      if (!containerRef.current || !canvasRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;

      const sourceAspect = NATIVE_VIEWPORT_WIDTH / NATIVE_VIEWPORT_HEIGHT;
      const containerAspect = containerWidth / containerHeight;

      let displayWidth: number;
      let displayHeight: number;

      if (containerAspect > sourceAspect) {
        displayHeight = containerHeight;
        displayWidth = containerHeight * sourceAspect;
      } else {
        displayWidth = containerWidth;
        displayHeight = containerWidth / sourceAspect;
      }

      setCanvasStyle({
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      });
    };

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
  }, []);

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

      const fpsInterval = setInterval(() => {
        const metrics = rendererRef.current?.getMetrics();
        if (metrics) {
          setFps(metrics.avgFrameRate);
        }
      }, 1000);

      return () => {
        clearInterval(fpsInterval);
        rendererRef.current?.destroy();
        rendererRef.current = null;
      };
    } catch (error) {
      console.error('[LiveFeed] Failed to initialize binary renderer:', error);
    }
  }, [useBinaryStream, binaryWsUrl]);

  // Frame rendering
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
    <div className="flex flex-col w-full h-full overflow-hidden bg-white shadow-md rounded-md border border-gray-200">

      {/* BROWSER CHROME - Real browser look with traffic lights */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 shrink-0 rounded-t-md">
        {/* LEFT: Browser traffic light buttons */}
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-400"></span>
          <span className="h-3 w-3 rounded-full bg-yellow-400"></span>
          <span className="h-3 w-3 rounded-full bg-green-400"></span>
        </div>

        {/* CENTER: URL display */}
        <div className="flex-1 mx-4 bg-gray-50 rounded-md px-3 py-1 text-xs text-gray-600 truncate shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
          {displayUrl}
        </div>

        {/* RIGHT: Status indicator */}
        <div className="flex items-center gap-2">
          {(isTestRunning || useBinaryStream) && (
            <span className="flex items-center gap-1.5 text-xs font-mono text-green-600">
              <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></span>
              {fps > 0 ? fps : 60} FPS
            </span>
          )}
          {!isTestRunning && !useBinaryStream && (
            <span className="text-xs text-gray-400">Ready</span>
          )}
        </div>
      </div>

      {/* CANVAS CONTAINER - White Industrial */}
      <div
        ref={containerRef}
        className="flex flex-col items-center justify-center flex-1 min-h-0 bg-white overflow-hidden p-0 relative"
      >
        {/* IDLE STATE */}
        {isIdle && (
          <div
            className="absolute flex items-center justify-center z-10 bg-white"
            style={{ width: canvasStyle.width, height: canvasStyle.height }}
          >
            <p className="font-mono text-sm tracking-[0.3em] uppercase text-black">
              ENTER TARGET URL TO INITIATE
            </p>
          </div>
        )}

        {/* INITIALIZING STATE */}
        {isInitializingScreen && (
          <div
            className="absolute flex flex-col items-center justify-center z-10 bg-white"
            style={{ width: canvasStyle.width, height: canvasStyle.height }}
          >
            <div className="mb-4 flex items-center justify-center gap-1">
              <span className="h-2 w-2 bg-black animate-pulse"></span>
              <span className="h-2 w-2 bg-black animate-pulse" style={{ animationDelay: '150ms' }}></span>
              <span className="h-2 w-2 bg-black animate-pulse" style={{ animationDelay: '300ms' }}></span>
            </div>
            <p className="font-mono text-sm tracking-[0.3em] uppercase text-black">
              ESTABLISHING TELEMETRY STREAM
            </p>
          </div>
        )}

        {/* COMPLETED STATE */}
        {isCompleted && (
          <div
            className="absolute flex items-center justify-center z-10 bg-white"
            style={{ width: canvasStyle.width, height: canvasStyle.height }}
          >
            <p className="font-mono text-sm tracking-[0.3em] uppercase text-black">
              EXPLORATION COMPLETE
            </p>
          </div>
        )}

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          style={{
            width: canvasStyle.width,
            height: canvasStyle.height,
            maxWidth: '100%',
            maxHeight: '100%',
          }}
          className="block object-contain"
        />
      </div>
    </div>
  );
}
