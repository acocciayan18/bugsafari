// Web Audio cues for run completion — synthesized, so there is no asset fetch,
// CSP, or autoplay-on-load to fail. One shared context, resumed lazily since a
// run finishing in a backgrounded tab can leave it suspended.

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

// Builds the cue on the shared context once it is running; audio is non-critical
// so any failure is swallowed rather than surfaced to the run flow.
function schedule(build: (ac: AudioContext) => void): void {
  try {
    const ac = audioContext();
    if (!ac) return;
    const run = () => build(ac);
    if (ac.state === 'suspended') ac.resume().then(run).catch(() => {});
    else run();
  } catch {
    // ignore — the run flow must never break on a notification sound
  }
}

// One sine note with a click-free attack/decay envelope.
function tone(ac: AudioContext, freq: number, start: number, peak: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + 0.19);
}

// Struck-bell partials [ratio, weight, decay] — inharmonic overtones give the
// metallic timbre; higher partials fade faster for a soft, round tail.
const BELL_PARTIALS: readonly (readonly [number, number, number])[] = [
  [1.0, 1.0, 1.6],
  [2.0, 0.55, 1.1],
  [2.4, 0.35, 0.8],
  [3.0, 0.2, 0.6],
  [4.2, 0.12, 0.4],
];

function bell(ac: AudioContext, fundamental: number, start: number, peak: number): void {
  for (const [ratio, weight, decay] of BELL_PARTIALS) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = fundamental * ratio;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak * weight, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + decay + 0.02);
  }
}

// Soft bell strike — a clean finish.
export function playSuccessSound(): void {
  schedule((ac) => bell(ac, 784, ac.currentTime, 0.11));
}

// Falling low two-tone buzz — a crash or fault.
export function playErrorSound(): void {
  schedule((ac) => {
    const t = ac.currentTime;
    tone(ac, 400, t, 0.14);
    tone(ac, 300, t + 0.14, 0.12);
  });
}
