// BrowserPanel Component - Headless Browser Viewer
// Left panel for the 50/50 split view in Command Center layout
// Extracts and adapts the browser frame from ClinicalForensicsDashboard

import { useEffect, useRef, useState } from 'react';
import { LiveFeedRenderer } from '../infrastructure/socket/BinaryFrameReceiver';

interface BrowserPanelProps {
    currentUrl: string;
    frame: string | null;
    isConnected: boolean;
    isTestRunning: boolean;
    testStatus?: 'IDLE' | 'RUNNING' | 'PAUSED';
    hasRunCompleted?: boolean;
    isInitializing?: boolean;
    liveFrame?: string | null;
    onPause?: () => void;
    onResume?: () => void;
    onStop?: () => void;
    useBinaryStream?: boolean;
    binaryWsUrl?: string;
}

// Native viewport resolution for canvas rendering
const NATIVE_VIEWPORT_WIDTH = 1440;
const NATIVE_VIEWPORT_HEIGHT = 900;

export default function BrowserPanel({
    currentUrl,
    frame,
    isConnected,
    isTestRunning,
    testStatus = 'IDLE',
    hasRunCompleted = false,
    isInitializing = false,
    liveFrame = null,
    onPause,
    onResume,
    onStop,
    useBinaryStream = false,
    binaryWsUrl = 'ws://localhost:8765',
}: BrowserPanelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<LiveFeedRenderer | null>(null);
    const [isBinaryConnected, setIsBinaryConnected] = useState(false);
    const [fps, setFps] = useState(0);
    const [canvasStyle, setCanvasStyle] = useState({ width: '100%', height: '100%' });

    // Determine scene states
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

    // Binary stream setup
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
            console.error('[BrowserPanel] Failed to initialize binary renderer:', error);
        }
    }, [useBinaryStream, binaryWsUrl]);

    // Render frame
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

    // Get status badge
    const getStatusBadge = () => {
        const isRunning = testStatus === 'RUNNING';
        const isPaused = testStatus === 'PAUSED';

        let statusText = 'READY';
        let statusClass = 'bg-gray-100 text-gray-600';
        let dotClass = 'bg-gray-400';

        if (isRunning) {
            statusText = 'RUNNING';
            statusClass = 'bg-emerald-50 text-emerald-700 border border-emerald-300';
            dotClass = 'bg-emerald-500 animate-pulse';
        } else if (isPaused) {
            statusText = 'PAUSED';
            statusClass = 'bg-amber-50 text-amber-700 border border-amber-300';
            dotClass = 'bg-amber-500';
        }

        return { statusText, statusClass, dotClass };
    };

    const { statusText, statusClass, dotClass } = getStatusBadge();

    return (
        <div className="flex flex-col h-full w-full rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* HEADER */}
            <div className="flex items-center justify-between shrink-0 border-b border-gray-200 bg-white px-4 py-2">
                <div className="flex items-center gap-3">
                    {/* Window Controls */}
                    <div className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-full bg-gray-300" />
                        <span className="h-3 w-3 rounded-full bg-gray-300" />
                        <span className="h-3 w-3 rounded-full bg-gray-300" />
                    </div>

                    {/* Title */}
                    <span className="text-sm font-semibold text-gray-900">
                        HEADLESS BROWSER
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    {/* FPS Counter */}
                    {fps > 0 && (
                        <span className="text-xs font-mono text-gray-500">
                            {Math.round(fps)} FPS
                        </span>
                    )}

                    {/* READY Status Badge */}
                    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                        {statusText}
                    </span>

                    {/* Control Buttons - Pause/Resume/Stop in header */}
                    {(testStatus === 'RUNNING' || testStatus === 'PAUSED') && (
                        <div className="flex items-center gap-2">
                            {testStatus === 'RUNNING' && onPause && (
                                <button
                                    onClick={onPause}
                                    className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                                >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    Pause
                                </button>
                            )}
                            {testStatus === 'PAUSED' && onResume && (
                                <button
                                    onClick={onResume}
                                    className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
                                >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    </svg>
                                    Resume
                                </button>
                            )}
                            {onStop && (
                                <button
                                    onClick={onStop}
                                    className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                                >
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                                    </svg>
                                    Stop
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* VIEWPORT */}
            <div
                ref={containerRef}
                className="flex flex-col items-center justify-center flex-1 min-h-0 bg-white overflow-hidden p-2 relative"
            >
                {/* IDLE STATE */}
                {isIdle && (
                    <div
                        className="absolute flex items-center justify-center z-10 bg-white"
                        style={{ width: canvasStyle.width, height: canvasStyle.height }}
                    >
                        <p className="whitespace-pre-wrap px-4 text-center font-mono text-sm tracking-wider uppercase text-gray-500">
                            READY TO INFILTRATE — ENTER TARGET URL TO START SAFARI
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
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-600" style={{ animationDelay: '0ms' }} />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-600" style={{ animationDelay: '150ms' }} />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-600" style={{ animationDelay: '300ms' }} />
                        </div>
                        <p className="whitespace-pre-wrap px-4 text-center font-mono text-sm tracking-wider uppercase text-gray-500">
                            SPINNING UP HEADLESS ENVIRONMENT...
                        </p>
                    </div>
                )}

                {/* COMPLETED STATE */}
                {isCompleted && (
                    <div
                        className="absolute flex items-center justify-center z-10 bg-white"
                        style={{ width: canvasStyle.width, height: canvasStyle.height }}
                    >
                        <p className="whitespace-pre-wrap px-4 text-center font-mono text-sm tracking-wider uppercase text-gray-500">
                            EXPLORATION COMPLETE — FORENSIC EVIDENCE COLLECTED
                        </p>
                    </div>
                )}

                {/* CANVAS */}
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

            {/* CONTROL BAR - Minimal footer with just status */}
            <div className="flex items-center justify-between shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-600">
                        Engine:
                    </span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                        {testStatus}
                    </span>
                </div>
            </div>
        </div>
    );
}
