interface QueueStatusBannerProps {
  isQueued: boolean;
  position: number | null;
  queueDepth: number;
}

// Non-modal banner shown while an enqueued run waits for a free worker. Mirrors
// ConnectionStatusOverlay's placement/styling so the two never fight for the same
// top-center slot visually. Renders nothing once the run leaves the queue.
export default function QueueStatusBanner({ isQueued, position, queueDepth }: QueueStatusBannerProps) {
  if (!isQueued) return null;

  const place = position && position > 0
    ? `position ${position}${queueDepth > 0 ? ` of ${queueDepth}` : ''}`
    : 'holding for a free worker';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9998] flex flex-col items-center gap-2 p-3">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center gap-2.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg ring-1 ring-indigo-700/40"
      >
        <span
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden="true"
        />
        <span>Queued for the Safari worker fleet — {place}. Execution begins automatically.</span>
      </div>
    </div>
  );
}
