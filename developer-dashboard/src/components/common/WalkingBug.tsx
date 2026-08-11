import { useEffect, useMemo, type ReactElement } from 'react';

// Detailed side-view bugs for the boot loader; one is chosen at random per mount.
type BugType = 'ant' | 'beetle' | 'ladybug' | 'spider';
const TYPES: BugType[] = ['ant', 'beetle', 'ladybug', 'spider'];

declare global {
  interface Window { __BOOT_BUG__?: string }
}

// Continue the exact bug the pre-mount #boot-screen picked, else random.
function pickType(): BugType {
  const h = typeof window !== 'undefined' ? window.__BOOT_BUG__ : undefined;
  if (h === 'ant' || h === 'beetle' || h === 'ladybug' || h === 'spider') return h;
  return TYPES[Math.floor(Math.random() * TYPES.length)];
}

const HY = 22;

// Two-segment jointed leg; first half of the row steps back, second half forward, parity splits the gait groups.
function buildLegs(hips: number[], spider: boolean) {
  const a: ReactElement[] = [];
  const b: ReactElement[] = [];
  const mid = (hips.length - 1) / 2;
  hips.forEach((hx, i) => {
    const dir = i <= mid ? -1 : 1;
    const kx = hx + dir * (spider ? 5 : 1.5);
    const ky = spider ? HY - 3 : HY + 5;
    const fx = hx + dir * (spider ? 9 : 4);
    const el = <polyline key={i} className="bugwalk-leg" points={`${hx},${HY} ${kx},${ky} ${fx},32`} />;
    (i % 2 ? b : a).push(el);
  });
  return { a, b };
}

const LEGS6 = buildLegs([15, 21, 27, 35, 41, 47], false);
const LEGS8 = buildLegs([33, 36, 39, 42, 33, 36, 39, 42], true);

// Bodies share the 0 0 64 40 viewBox and the y=22 leg-attach line so one gait fits all.
const BODIES: Record<BugType, ReactElement> = {
  ant: (
    <g className="bugwalk-bob">
      <ellipse cx="14" cy="16" rx="8" ry="6.5" />
      <ellipse cx="27" cy="16" rx="4.5" ry="4" />
      <circle cx="40" cy="15" r="5" />
      <polyline className="bugwalk-antenna" points="43,12 48,6 50,7" />
      <polyline className="bugwalk-antenna" points="43,13 49,9 51,10" />
    </g>
  ),
  beetle: (
    <g className="bugwalk-bob">
      <ellipse cx="24" cy="16" rx="16" ry="9" />
      <ellipse cx="44" cy="16" rx="5" ry="4.5" />
      <line className="bugwalk-line" x1="10" y1="16" x2="38" y2="16" />
      <line className="bugwalk-line" x1="32" y1="8" x2="32" y2="24" />
      <polyline className="bugwalk-antenna" points="47,13 52,9" />
      <polyline className="bugwalk-antenna" points="47,15 53,13" />
    </g>
  ),
  ladybug: (
    <g className="bugwalk-bob">
      <ellipse cx="23" cy="15" rx="15" ry="10" />
      <ellipse cx="41" cy="15" rx="5.5" ry="4.5" />
      <line className="bugwalk-line" x1="9" y1="15" x2="37" y2="15" />
      <circle className="bugwalk-hole" cx="17" cy="11" r="2" />
      <circle className="bugwalk-hole" cx="26" cy="18" r="2" />
      <circle className="bugwalk-hole" cx="30" cy="10" r="1.8" />
      <circle className="bugwalk-hole" cx="20" cy="19" r="1.6" />
      <polyline className="bugwalk-antenna" points="44,12 49,7" />
      <polyline className="bugwalk-antenna" points="44,14 50,10" />
    </g>
  ),
  spider: (
    <g className="bugwalk-bob">
      <ellipse cx="20" cy="16" rx="10" ry="8" />
      <ellipse cx="35" cy="16" rx="6" ry="5" />
    </g>
  ),
};

// Continuous horizontal march; legs swing in alternating groups so it walks, not slides.
export default function WalkingBug() {
  const type = useMemo(() => pickType(), []);

  // Release the handoff so later boot loaders in the session pick a fresh bug.
  useEffect(() => {
    if (typeof window !== 'undefined') window.__BOOT_BUG__ = undefined;
  }, []);

  const legs = type === 'spider' ? LEGS8 : LEGS6;

  return (
    <div className="bugwalk-track">
      <span className="bugwalk-ground" />
      <div className="bugwalk-march">
        <svg className="bugwalk-svg" viewBox="0 0 64 40" role="img" aria-label={`${type} walking`}>
          <g className="bugwalk-legs bugwalk-legs--a">{legs.a}</g>
          <g className="bugwalk-legs bugwalk-legs--b">{legs.b}</g>
          {BODIES[type]}
        </svg>
      </div>
    </div>
  );
}
