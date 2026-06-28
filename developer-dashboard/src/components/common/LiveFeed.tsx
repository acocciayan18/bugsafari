// Live Feed Component - INDUSTRIAL VIEWPORT
// High-contrast brutalist technical aesthetic
// Dark container for canvas streaming

import { useEffect, useRef, useState, useCallback } from 'react';
import { LiveFeedRenderer } from '../../infrastructure/socket/BinaryFrameReceiver';

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
  const [canvasDisplaySize, setCanvasDisplaySize] = useState({ 
    width: `${NATIVE_VIEWPORT_WIDTH}px`, 
    height: `${NATIVE_VIEWPORT_HEIGHT}px` 
  });

  // Status determination
  const isIdle = !isTestRunning && !hasRunCompleted && !isInitializing;
  const isInitializingScreen = isInitializing || (isTestRunning && !liveFrame);
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

    const containerRect = containerRef.current.getBoundingClientRect();
    const coverData = calculateCoverDimensions();

    // Diagnostic: Log LiveFeed rendering metrics (cover mode)
    console.log(`[LiveFeed] Render: container=${containerRect.width.toFixed(0)}x${containerRect.height.toFixed(0)}, native=${NATIVE_VIEWPORT_WIDTH}x${NATIVE_VIEWPORT_HEIGHT}, canvasInternal=${coverData.canvasWidth}x${coverData.canvasHeight}, scale=${coverData.scale.toFixed(3)}`);

    // Set canvas INTERNAL resolution to scaled dimensions
    // This implements object-fit: cover - the image fills the canvas without stretching
    canvasRef.current.width = coverData.canvasWidth;
    canvasRef.current.height = coverData.canvasHeight;

    // Update state for placeholders (idle, initializing, completed screens)
    setCanvasDisplaySize({
      width: `${coverData.canvasWidth}px`,
      height: `${coverData.canvasHeight}px`
    });
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

// Frame rendering - uses object-fit: cover (fills canvas, cropped if needed)
  const renderFrame = liveFrame || frame;

  useEffect(() => {
    if (renderFrame && !useBinaryStream && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          // Draw image to fill canvas (object-fit: cover behavior)
          // Canvas internal resolution already set to cover dimensions
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = renderFrame.startsWith('data:') ? renderFrame : `data:image/jpeg;base64,${renderFrame}`;
      }
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
            style={{ width: canvasDisplaySize.width, height: canvasDisplaySize.height }}
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
            style={{ width: canvasDisplaySize.width, height: canvasDisplaySize.height }}
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
            style={{ width: canvasDisplaySize.width, height: canvasDisplaySize.height }}
          >
            <p className="font-mono text-sm tracking-[0.3em] uppercase text-black">
              EXPLORATION COMPLETE
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
