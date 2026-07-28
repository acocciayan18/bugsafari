import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SECTION_META } from './sectionMeta';
import { INFILTRATION_PROFILE_CATALOG, DEFAULT_INFILTRATION_PROFILE } from '../types';

const PageShell = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => {
    const navigate = useNavigate();

    return (
        <div className="bg-white text-black min-h-screen font-sans selection:bg-black selection:text-white">
            {/* Top Navigation Bar */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-zinc-200 shadow-sm">
                <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1440px] mx-auto">
                    <div className="flex items-center gap-8">
                        <button onClick={() => navigate('/')} className="text-[24px] font-extrabold text-black tracking-tighter uppercase text-left bg-transparent border-none cursor-pointer">
                            BUGSAFARI
                        </button>
                        <div className="hidden md:flex items-center gap-6">
                            <button onClick={() => navigate('/explore')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('Explore') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>Explore</button>
                            <button onClick={() => navigate('/features')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('Core Features') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>Features</button>
                            <button onClick={() => navigate('/community')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('Community') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>Community</button>
                            <button onClick={() => navigate('/about')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('About') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>About</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/login')}
                            className="px-5 py-2 font-mono text-[13px] font-semibold bg-black text-white rounded-lg shadow-sm hover:bg-zinc-800 transition-all focus:ring-2 focus:ring-black focus:outline-none cursor-pointer"
                        >
                            Log In
                        </button>
                    </div>
                </div>
            </nav>

            <main className="pt-32 pb-24 px-6 max-w-[1440px] mx-auto">
                <div className="space-y-4 mb-16 border-b border-zinc-200 pb-8">
                    <h1 className="text-[40px] lg:text-[56px] font-extrabold uppercase tracking-tight">{title}</h1>
                    <p className="text-[16px] text-zinc-600 max-w-2xl">{subtitle}</p>
                </div>
                {children}
            </main>
        </div>
    );
};

// Shared marketing building blocks, reused across all four info pages.

function StatRow({ items }: { items: { value: string; label: string }[] }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-200 border border-zinc-200 rounded-xl overflow-hidden">
            {items.map((it) => (
                <div key={it.label} className="bg-white p-6 text-center space-y-1">
                    <div className="text-3xl font-extrabold tracking-tight">{it.value}</div>
                    <div className="text-xs font-mono uppercase tracking-wide text-zinc-500">{it.label}</div>
                </div>
            ))}
        </div>
    );
}

function SplitSection({ eyebrow, heading, description, bullets, image, imageAlt, badge, reverse }: {
    eyebrow: string; heading: string; description: string; bullets: string[];
    image: string; imageAlt: string; badge?: { value: string; label: string }; reverse?: boolean;
}) {
    return (
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
            <div className="space-y-5">
                <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">{eyebrow}</span>
                <h2 className="text-2xl lg:text-3xl font-extrabold uppercase tracking-tight">{heading}</h2>
                <p className="text-zinc-600 leading-relaxed">{description}</p>
                <ul className="space-y-3 pt-2">
                    {bullets.map((b) => (
                        <li key={b} className="flex gap-3 text-[13px] text-zinc-700">
                            <span className="w-1.5 h-1.5 mt-2 rounded-full bg-black shrink-0" />
                            {b}
                        </li>
                    ))}
                </ul>
            </div>
            <div className="relative">
                <img src={image} alt={imageAlt} className="w-full rounded-xl border border-zinc-200 shadow-lg" />
                {badge && (
                    <div className="absolute -bottom-6 -left-6 bg-black text-white rounded-xl p-5 shadow-xl hidden sm:block">
                        <div className="text-2xl font-extrabold">{badge.value}</div>
                        <div className="text-xs font-mono uppercase tracking-wide text-zinc-400">{badge.label}</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
    return (
        <div className="border border-zinc-200 rounded-2xl divide-y divide-zinc-200 bg-white overflow-hidden">
            {items.map((it) => (
                <details key={it.q} className="group p-6">
                    <summary className="cursor-pointer list-none flex justify-between items-center gap-4 font-bold text-base">
                        {it.q}
                        <span className="shrink-0 w-6 h-6 rounded-full border border-zinc-300 flex items-center justify-center text-[13px] group-open:rotate-45 transition-transform">+</span>
                    </summary>
                    <p className="pt-3 text-[13px] text-zinc-600 leading-relaxed">{it.a}</p>
                </details>
            ))}
        </div>
    );
}

function DarkCta({ heading, sub }: { heading: string; sub: string }) {
    const navigate = useNavigate();
    return (
        <div className="bg-black text-white rounded-2xl p-10 lg:p-16 text-center space-y-6">
            <h2 className="text-2xl lg:text-4xl font-extrabold uppercase tracking-tight">{heading}</h2>
            <p className="text-zinc-400 max-w-xl mx-auto">{sub}</p>
            <button
                onClick={() => navigate('/login')}
                className="px-8 py-3 font-mono text-[13px] font-semibold bg-white text-black rounded-lg hover:bg-zinc-200 transition-all cursor-pointer"
            >
                Start Testing Free
            </button>
        </div>
    );
}

// Rendered straight from the shared catalog the engine gates on — a local copy
// silently drifted from what the profiles actually do.
function ProfileTabs() {
    const [active, setActive] = useState(0);
    const profile = INFILTRATION_PROFILE_CATALOG[active];
    return (
        <div className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
            <div className="flex overflow-x-auto border-b border-zinc-200 scroll-rail">
                {INFILTRATION_PROFILE_CATALOG.map((p, i) => (
                    <button
                        key={p.id}
                        onClick={() => setActive(i)}
                        className={`px-5 py-4 font-mono text-xs font-semibold uppercase whitespace-nowrap border-b-2 transition-colors bg-transparent cursor-pointer ${active === i ? 'border-black text-black' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
            <div className="p-8">
                <h4 className="font-bold text-lg mb-2">{profile.label}</h4>
                <p className="text-[13px] text-zinc-600 leading-relaxed max-w-2xl">
                    {profile.description}
                    {profile.id === DEFAULT_INFILTRATION_PROFILE ? ' The default profile.' : ''}
                </p>
            </div>
        </div>
    );
}

const BUG_TAXONOMY = [
    ['Input Sanitization Failure', 'CWE-20'],
    ['Client-Side Constraint Bypass', 'CWE-602'],
    ['NoSQL Injection', 'CWE-943'],
    ['SPA State Race Condition', 'CWE-362'],
    ['Structural Navigation Logic', 'CWE-835'],
    ['Runtime Stability Exception', 'CWE-248'],
    ['Boundary Stress Failure', 'CWE-400'],
    ['Fuzz Vulnerability Leak', 'CWE-79'],
    ['Security Vulnerability Leak', 'CWE-200'],
    ['Cascading State Failure', 'CWE-754'],
    ['Client Trust Boundary Violation', 'CWE-602'],
    ['Infinite Loading', 'CWE-400'],
];

function BugTaxonomyGrid() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {BUG_TAXONOMY.map(([name, cwe]) => (
                <div key={name} className="flex items-center justify-between gap-3 px-4 py-3 border border-zinc-200 rounded-lg bg-zinc-50/50">
                    <span className="text-[13px] font-semibold">{name}</span>
                    <span className="font-mono text-xs text-zinc-400 shrink-0">{cwe}</span>
                </div>
            ))}
        </div>
    );
}

export function ExploreContent() {
    return (
            <div className="space-y-16">
                <SplitSection
                    eyebrow="Scriptless Discovery"
                    heading="No Fixtures. No Hand-Written Paths."
                    description="Every step, a recursive DOM parser extracts the live page's visible interactive candidates, verifies each one with elementFromPoint to reject anything hidden behind an overlay, and drops ancestor elements that only wrap other candidates so nothing gets double-weighted."
                    bullets={[
                        'Detects the active modal/overlay layer before scoring so exploration never fights a dialog it cannot see past.',
                        'Candidates are normalized into typed interactive-element structures shared across the whole engine.',
                        'A 5,000-element budget keeps parsing bounded even on dense, deeply-nested SPA views.',
                    ]}
                    image="/marketing/dashboard-shell.png"
                    imageAlt="BugSafari Command Center, idle and ready to receive a target URL"
                    badge={{ value: '5,000', label: 'Element Parse Budget' }}
                />

                <StatRow items={[
                    { value: '24', label: 'Perceptron Features' },
                    { value: '5', label: 'Loop-Prevention Layers' },
                    { value: '500', label: 'State-Graph Node Cap' },
                    { value: '20', label: 'Step Action Buffer' },
                ]} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold shrink-0">01</div>
                        <h3 className="text-xl font-bold uppercase">Adaptive Risk Prioritization</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Every candidate is scored as risk = heuristic × 0.6 + sigmoid(perceptron) × 100 × 0.4, minus penalties. A 24-feature single-layer perceptron learns live via a momentum-augmented delta rule, boosting login, payment, delete, and other state-changing controls above low-value noise.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold shrink-0">02</div>
                        <h3 className="text-xl font-bold uppercase">State Graph Navigation</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">StateGraphNavigator tracks every transition and chooses explore-edge, backtrack, or exhausted using a diversity-penalized selection with softmax exploration, biasing toward edges that lead somewhere new instead of somewhere already saturated.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold shrink-0">03</div>
                        <h3 className="text-xl font-bold uppercase">Structural DOM Hashing</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Each page state is fingerprinted into a structure signature (normalized skeleton, dynamic classes stripped) and an interactive signature (document-ordered element tokens), combined into one hash so the engine recognizes a state it has already visited.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold shrink-0">04</div>
                        <h3 className="text-xl font-bold uppercase">Five-Layer Loop Prevention</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Consecutive-repeat strikes, forward look-ahead, reactive ancestor-hash detection, per-edge repeat budgets, and route-exhaustion tracking work together so the engine never spends its run clicking the same dead end.</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="space-y-2">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">Infiltration Profiles</span>
                        <h2 className="text-2xl font-extrabold uppercase tracking-tight">One Target URL, Five Ways In</h2>
                        <p className="text-zinc-600 max-w-2xl">Every run picks one profile, which gates which scenario families fire and derives the pathfinder's mode — exploration, coverage, or targeted probe.</p>
                    </div>
                    <ProfileTabs />
                </div>

                <FaqAccordion items={[
                    { q: 'Do I need to write test scripts?', a: 'No. The recursive DOM parser discovers interactive elements straight from the live page on every step — there is no fixture, selector list, or path to hand-author before a run.' },
                    { q: 'How does it avoid clicking the same button forever?', a: 'Five independent layers — repeat-strike thresholds, forward look-ahead, ancestor-hash detection, per-edge repeat budgets, and route-exhaustion tracking — keep the state graph moving toward unexplored territory instead of circling.' },
                    { q: 'Can a run wander off the target site?', a: 'Only if Strict Boundary Lock is off. When enabled, a page.route interceptor plus an init-script sandbox blocks any off-origin navigation before it commits.' },
                    { q: 'What happens when the app runs out of new states?', a: 'A cluster is marked saturated once every discovered control has been triggered, then the engine runs up to two adaptive recovery rounds before terminating with a boundary-saturated outcome.' },
                ]} />

                <DarkCta heading="Watch It Explore Your App" sub="Point BugSafari at a target URL and see the state graph, the risk scores, and the live telemetry build in real time." />
            </div>
    );
}

export function ExplorePage() {
    return (
        <PageShell title={SECTION_META.explore.title} subtitle={SECTION_META.explore.subtitle}>
            <ExploreContent />
        </PageShell>
    );
}

export function FeaturesContent() {
    return (
            <div className="space-y-16">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold mb-6 shrink-0">AI</div>
                            <h3 className="text-xl font-bold uppercase mb-2">Scriptless Traversal</h3>
                            <p className="text-[13px] text-zinc-600 leading-relaxed">A recursive DOM parser discovers every interactive candidate live, verifies visibility with elementFromPoint, and hands each one to the risk model — no manual test script or selector map required.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Zero Configuration</div>
                    </div>

                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold mb-6 shrink-0">ML</div>
                            <h3 className="text-xl font-bold uppercase mb-2">Adaptive Intelligence</h3>
                            <p className="text-[13px] text-zinc-600 leading-relaxed">A 24-feature single-layer perceptron scores every candidate and updates its weights after every observed outcome — a fault, a network call, a repeated state — via a momentum-augmented delta rule.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Self-Learning Core</div>
                    </div>

                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold mb-6 shrink-0">RT</div>
                            <h3 className="text-xl font-bold uppercase mb-2">Real-Time Forensics</h3>
                            <p className="text-[13px] text-zinc-600 leading-relaxed">A 20-step circular action buffer plus narrated reproduction steps capture exactly what happened, so any saved finding can be deterministically replayed to verify a fix.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Verify Fix Replay</div>
                    </div>
                </div>

                <SplitSection
                    eyebrow="Attack Scenarios"
                    heading="Five Ways to Stress a Target"
                    description="Each infiltration profile gates a different family of live scenarios — from concurrent-click bursts to escalating fuzz payloads — so a run can be tuned to exactly the kind of defect you're hunting."
                    bullets={[
                        'DataFuzzer classifies inputs into 7 categories and escalates payloads across 5 levels, from base cases to polyglot amplification.',
                        'FormBypasser strips disabled, readonly, and pattern constraints to test whether validation is actually enforced server-side.',
                        'AsyncStateRacer fires an action without awaiting it, then interrupts mid-flight to expose teardown races and swallowed rejections.',
                    ]}
                    image="/marketing/profile-selector.png"
                    imageAlt="BugSafari Testing Configuration modal showing the five Infiltration Profiles"
                    reverse
                />

                <div>
                    <div className="mb-6 space-y-2">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">Infiltration Matrix</span>
                        <h2 className="text-2xl font-extrabold uppercase tracking-tight">Pick a Profile, Not a Script</h2>
                    </div>
                    <ProfileTabs />
                </div>

                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-zinc-50/50 space-y-8">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Advanced Platform Capabilities</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">01</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Provenance Attribution</h4>
                                <p className="text-[13px] text-zinc-600">Every candidate fault is classified as target-app, BugSafari, Playwright, browser extension, network, or timing noise — so only real application defects ever get reported.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">02</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Deterministic Fault Classification</h4>
                                <p className="text-[13px] text-zinc-600">One shared knowledge base resolves bug class, severity, and remediation from a runtime signal — the same signal always yields the same verdict, regardless of which detector saw it.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">03</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Verify Fix Regression Replay</h4>
                                <p className="text-[13px] text-zinc-600">Open a fresh isolated browser, restore the exact storage state, and replay a saved finding's own recorded actions to confirm whether it's resolved, still active, or inconclusive.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">04</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Strict Boundary Lock</h4>
                                <p className="text-[13px] text-zinc-600">A route interceptor plus an init-script sandbox neutralizes off-origin navigation, keeping exploration confined to the exact target URL when you need it to be.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="space-y-2">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">Bug Taxonomy</span>
                        <h2 className="text-2xl font-extrabold uppercase tracking-tight">12 Deterministic Bug Classes</h2>
                        <p className="text-zinc-600 max-w-2xl">Every finding maps to one of twelve classes, each carrying a default severity, a CWE reference, and remediation guidance.</p>
                    </div>
                    <BugTaxonomyGrid />
                </div>

                <DarkCta heading="See Every Feature Live" sub="Run BugSafari against your own app and watch scoring, scenarios, and forensic capture work together in one session." />
            </div>
    );
}

export function FeaturesPage() {
    return (
        <PageShell title={SECTION_META.features.title} subtitle={SECTION_META.features.subtitle}>
            <FeaturesContent />
        </PageShell>
    );
}

export function CommunityContent() {
    return (
            <div className="space-y-16">
                <SplitSection
                    eyebrow="Who It's For"
                    heading="Built for Builders Under Deadline"
                    description="The primary audience is student developers and independent engineers who need rapid feedback on unstable behavior before demos, submissions, or deployment milestones. BugSafari acts as an automated resilience probe that surfaces high-impact failures early and leaves enough evidence to understand what happened."
                    bullets={[
                        'No QA team required — one person can start a run, read the forensic report, and know exactly what broke and why.',
                        'Guest mode lets anyone try a full live run against their own app with zero signup.',
                        'Registered accounts keep history, export findings as JSON, and verify a fix once it ships.',
                    ]}
                    image="/marketing/dashboard-shell.png"
                    imageAlt="BugSafari Command Center ready to launch a run"
                    badge={{ value: '0', label: 'Setup Steps to Try It' }}
                />

                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-zinc-50/50 space-y-8">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">How It Fits Your Workflow</h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <span className="font-mono text-xs font-bold text-zinc-400 uppercase">Step 01</span>
                            <h4 className="font-bold text-lg">Configure</h4>
                            <p className="text-xs text-zinc-600">Enter a target URL, choose one of five Infiltration Profiles, and optionally lock exploration to that exact domain.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <span className="font-mono text-xs font-bold text-zinc-400 uppercase">Step 02</span>
                            <h4 className="font-bold text-lg">Launch</h4>
                            <p className="text-xs text-zinc-600">One click starts a headless Chromium session. Pause or resume anytime without losing progress.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <span className="font-mono text-xs font-bold text-zinc-400 uppercase">Step 03</span>
                            <h4 className="font-bold text-lg">Watch Live</h4>
                            <p className="text-xs text-zinc-600">Telemetry, Findings, Network, and Console stream over sockets in real time as the engine explores.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <span className="font-mono text-xs font-bold text-zinc-400 uppercase">Step 04</span>
                            <h4 className="font-bold text-lg">Verify</h4>
                            <p className="text-xs text-zinc-600">Save the run, open its forensic report, and hit Verify Fix to replay any finding after you patch it.</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4">
                        <div className="w-10 h-10 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold text-[13px]">01</div>
                        <h3 className="text-xl font-bold uppercase">Try Before You Sign Up</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Guest mode runs the exact same exploration engine and live dashboard as a registered account. The only difference is that a guest run isn't written to history — it exists for the length of the session.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4">
                        <div className="w-10 h-10 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold text-[13px]">02</div>
                        <h3 className="text-xl font-bold uppercase">Own Your Findings</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Every history query and forensic record is scoped to the owning account. Save a session once and it's yours to search, export, and re-verify whenever you come back to it.</p>
                    </div>
                </div>

                <FaqAccordion items={[
                    { q: 'Do I need an account to try it?', a: 'No. Guest mode lets you enter a target URL, pick a profile, and watch a full live run with the same telemetry and reporting the registered dashboard uses — sessions just aren\'t saved.' },
                    { q: 'What do I get by registering?', a: 'Saved run history with search and filtering, a full-detail forensic report per session, JSON export, and the ability to re-verify a finding with Verify Fix after you ship a patch.' },
                    { q: 'Is my target app data isolated from other users?', a: 'Yes. Every history and forensic query filters on the owning account at the database level, and a run can additionally be re-attached only by whoever started it.' },
                ]} />

                <DarkCta heading="Bring Your Own App" sub="Whether you're prepping a demo tonight or hardening something before deploy, start a run and see what BugSafari finds." />
            </div>
    );
}

export function CommunityPage() {
    return (
        <PageShell title={SECTION_META.community.title} subtitle={SECTION_META.community.subtitle}>
            <CommunityContent />
        </PageShell>
    );
}

export function AboutContent() {
    return (
            <div className="space-y-16">
                <div className="space-y-6 text-zinc-700 leading-relaxed text-base max-w-4xl">
                    <p>BugSafari was born out of a simple frustration: modern Single-Page Applications hide subtle regressions, timing races, and validation bypasses that scripted, linear test suites never think to try. Randomized "monkey" testing has the opposite problem — plenty of activity, little structural intelligence, weak reproducibility, and low forensic value.</p>
                    <p>So we built an autonomous, scriptless exploration engine: it parses your app's live DOM, scores every interactive element with a self-learning perceptron, stress-tests state under concurrency and async chaos, fuzzes inputs with escalating payloads, and turns whatever breaks into a reproducible, replayable forensic record — no fixtures, no hand-written paths.</p>
                </div>

                <SplitSection
                    eyebrow="Under the Hood"
                    heading="One Engine, Five Cognitive Pillars"
                    description="Adaptive risk prioritization, state-aware navigation, high-speed behavioral simulation, generative attack synthesis, and real-time forensic isolation work together in a single decoupled architecture spanning the exploration engine, the dashboard, and a shared typed contract layer."
                    bullets={[
                        'testing-core hosts the headless exploration engine, scoring, scenarios, and Mongo-backed persistence.',
                        'developer-dashboard is the React operator console for live telemetry, history, and forensic reports.',
                        'A shared contract layer keeps both sides byte-identical on every event and record shape.',
                    ]}
                    image="/marketing/dashboard-shell.png"
                    imageAlt="The real BugSafari Command Center shell"
                />

                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-white shadow-sm space-y-8">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Our Core Principles</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-[13px] tracking-wide">01. Type Safety First</h4>
                            <p className="text-[13px] text-zinc-600">Strict TypeScript boundaries and explicit contracts across every package, enforced by one shared types layer the engine and dashboard both import from.</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-[13px] tracking-wide">02. Deterministic Classification</h4>
                            <p className="text-[13px] text-zinc-600">Every fault resolves through one shared knowledge base — the same signal always yields the same class, severity, and remediation, no matter which detector saw it first.</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-[13px] tracking-wide">03. Failure Isolation</h4>
                            <p className="text-[13px] text-zinc-600">Runtime and browser failures are handled defensively so one crashing scenario or finder never takes the rest of a run down with it.</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-[13px] tracking-wide">04. Persistence Discipline</h4>
                            <p className="text-[13px] text-zinc-600">Sessions, findings, action traces, and learned brain snapshots are Mongo-backed and scoped to the owning account, kept entirely out of domain logic.</p>
                        </div>
                    </div>
                </div>

                <StatRow items={[
                    { value: '12', label: 'Bug Classes' },
                    { value: '5', label: 'Infiltration Profiles' },
                    { value: '3', label: 'Monorepo Packages' },
                    { value: '1', label: 'Shared Contract Layer' },
                ]} />

                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-zinc-50/50 space-y-6">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Who We Build For</h2>
                    <p className="text-[13px] text-zinc-600 leading-relaxed max-w-3xl">
                        BugSafari's primary audience is student developers and independent engineers who need rapid feedback on unstable behavior before demos, submissions, or deployment milestones. It's designed to act as an automated resilience probe: one that surfaces high-impact failures early and leaves enough evidence behind to actually understand what happened, not just that something broke.
                    </p>
                </div>

                <DarkCta heading="Put It to Work" sub="Start a free run and see BugSafari's exploration, scoring, and forensic reporting on your own application." />
            </div>
    );
}

export function AboutPage() {
    return (
        <PageShell title={SECTION_META.about.title} subtitle={SECTION_META.about.subtitle}>
            <AboutContent />
        </PageShell>
    );
}
