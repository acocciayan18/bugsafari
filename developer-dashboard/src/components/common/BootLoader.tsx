import { useEffect, useState } from 'react';
import WalkingBug from './WalkingBug';

// Branded full-surface loading screen. Visually mirrors the pre-mount #boot-screen
// in index.html, so the HTML→React handoff during lazy-chunk loads never jumps.
const STAGES = ['Waking the engine', 'Loading workspace', 'Almost ready'];

export default function BootLoader({ label }: { label?: string }) {
  const [stage, setStage] = useState(0);

  // The pre-mount #boot-screen (index.html) and this React loader are both full-screen
  // and branded identically. While the boot-screen fades out they overlap, and their
  // independent stage timers stack two different lines (the garbled loading text). This
  // loader already covers the surface, so retire the pre-mount screen at once instead of
  // leaving it to fade underneath. Idempotent with main.tsx's own dismiss (guards on el).
  useEffect(() => {
    const el = document.getElementById('boot-screen');
    if (!el) return;
    (window as unknown as { __stopBoot?: () => void }).__stopBoot?.();
    el.remove();
  }, []);

  // Rotate reassurance copy on slow connections; a fixed label opts out.
  useEffect(() => {
    if (label) return;
    const id = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1400);
    return () => clearInterval(id);
  }, [label]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-(--surface-app) p-8"
    >
      {/* Exact px/weight/family match to the pre-mount #boot-screen wordmark, so the
          HTML→React handoff shows no size or weight change. */}
      <h1
        className="text-(--text-primary)"
        style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.01em', fontFamily: "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", margin: 0 }}
      >
        BUGSAFARI
      </h1>

      {/* Walking bug marches the track while the workspace loads. */}
      <WalkingBug />

      <p
        className="text-(--text-secondary)"
        style={{ fontSize: '13px', fontWeight: 500, fontFamily: "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", margin: 0 }}
      >
        {label ?? STAGES[stage]}…
      </p>
    </div>
  );
}
