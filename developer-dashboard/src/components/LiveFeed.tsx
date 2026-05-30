// Live Feed Component - Light Theme Browser Frame
// Optimized for ClinicalForensicsDashboard integration

import { useEffect, useRef, useState } from 'react';
import { LiveFeedRenderer } from '../infrastructure/socket/BinaryFrameReceiver';

interface LiveFeedProps {
  frame: string | null;
  isConnected: boolean;
  isTestRunning: boolean;
  currentUrl: string;
  useBinaryStream?: boolean;
  binaryWsUrl?: string;
}

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;

export default function LiveFeed({ 
  frame, 
  isConnected, 
  isTestRunning, 
  currentUrl, 
  useBinaryStream = false,
  binaryWsUrl = 'ws://localhost:8765'
}: LiveFeedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LiveFeedRenderer | null>(null);
  const [isBinaryConnected, setIsBinaryConnected] = useState(false);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!useBinaryStream || !canvasRef.current || rendererRef.current) {
      return;
    }

    try {
      rendererRef.current = new LiveFeedRenderer({
        canvasElement: canvasRef.current,
        wsUrl: binaryWsUrl,
        frameWidth: VIEWPORT_WIDTH,
        frameHeight: VIEWPORT_HEIGHT,
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

  useEffect(() => {
    if (frame && !useBinaryStream && canvasRef.current) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
          ctx.drawImage(img, 0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
        }
      };
      img.src = frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`;
    }
  }, [frame, useBinaryStream]);

  return (
    <div className="w-full max-w-5xl shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* BROWSER HEADER */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2 sm:px-5">
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

{/* VIEWPORT - Full vertical expansion, removing rigid height bounds */}
      <div className="min-h-[400px] h-auto flex-1 bg-white overflow-auto">
        <canvas
          ref={canvasRef}
          width={VIEWPORT_WIDTH}
          height={VIEWPORT_HEIGHT}
          className="h-auto w-full object-contain"
        />
      </div>
    </div>
  );
}
