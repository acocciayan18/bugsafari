import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Radar, Brain, ClipboardCheck, Target, Map, History, Ban,
    Filter, Scale, RefreshCcw, Lock, Settings, Play, Eye,
    CheckCircle2, Rocket, ShieldCheck, BadgeCheck, ListChecks, Sun, Moon, Menu, X,
} from 'lucide-react';
import { SECTION_META } from './sectionMeta';
import { INFILTRATION_PROFILE_CATALOG, DEFAULT_INFILTRATION_PROFILE } from '../types';
import { BrowserFrame } from '../components/marketing/ProductShot';
import { useDarkMode } from '../context/DarkModeContext';

const NAV_LINKS = [
    { to: '/explore', label: 'How It Works', match: 'Works' },
    { to: '/features', label: 'Features', match: 'Does' },
    { to: '/community', label: "Who It's For", match: 'Who' },
    { to: '/about', label: 'About', match: 'About' },
];

function ThemeToggle() {
    const { isDark, setMode } = useDarkMode();
    return (
        <button
            onClick={() => setMode(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="touch-target grid place-items-center w-10 h-10 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] cursor-pointer"
        >
            {isDark ? <Sun className="w-5 h-5" strokeWidth={1.75} /> : <Moon className="w-5 h-5" strokeWidth={1.75} />}
        </button>
    );
}

const PageShell = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <div className="bg-[var(--surface-app)] text-[var(--text-primary)] min-h-screen font-sans selection:bg-[var(--surface-invert)] selection:text-[var(--text-oninvert)]">
            <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--surface-app)]/95 backdrop-blur-md border-b border-[var(--border-hairline)]">
                <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1280px] mx-auto">
                    <div className="flex items-center gap-8">
                        <button onClick={() => navigate('/')} className="text-xl font-extrabold uppercase tracking-tighter text-[var(--text-primary)] bg-transparent border-none cursor-pointer">
                            BUGSAFARI
                        </button>
                        <div className="hidden md:flex items-center gap-6">
                            {NAV_LINKS.map((l) => (
                                <button
                                    key={l.to}
                                    onClick={() => navigate(l.to)}
                                    aria-current={title.includes(l.match) ? 'page' : undefined}
                                    className={`font-mono text-sm font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes(l.match) ? 'text-[var(--text-primary)] border-b border-[var(--text-primary)] pb-1' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
                                >
                                    {l.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                        <button
                            onClick={() => navigate('/login')}
                            className="hidden sm:inline-flex px-5 py-2 font-mono text-sm font-semibold bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg hover:bg-[var(--surface-invert-hover)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none cursor-pointer"
                        >
                            Log In
                        </button>
                        <button
                            onClick={() => setMenuOpen((v) => !v)}
                            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                            aria-expanded={menuOpen}
                            aria-controls="info-mobile-nav"
                            className="md:hidden touch-target grid place-items-center w-10 h-10 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none cursor-pointer"
                        >
                            {menuOpen ? <X className="w-5 h-5" strokeWidth={1.75} /> : <Menu className="w-5 h-5" strokeWidth={1.75} />}
                        </button>
                    </div>
                </div>

                {menuOpen && (
                    <div id="info-mobile-nav" className="md:hidden border-t border-[var(--border-hairline)] bg-[var(--surface-app)] px-6 py-4 space-y-1 animate-fade-in">
                        {NAV_LINKS.map((l) => (
                            <button
                                key={l.to}
                                onClick={() => { setMenuOpen(false); navigate(l.to); }}
                                aria-current={title.includes(l.match) ? 'page' : undefined}
                                className={`block w-full text-left px-3 py-3 rounded-lg font-mono text-sm font-medium transition-colors cursor-pointer ${title.includes(l.match) ? 'bg-[var(--surface-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'}`}
                            >
                                {l.label}
                            </button>
                        ))}
                        <button
                            onClick={() => { setMenuOpen(false); navigate('/login'); }}
                            className="block w-full mt-3 px-4 py-3 font-mono text-sm font-semibold bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg hover:bg-[var(--surface-invert-hover)] transition-colors cursor-pointer"
                        >
                            Log In
                        </button>
                    </div>
                )}
            </nav>

            <main className="pt-24 pb-12 px-6 max-w-[1280px] mx-auto">
                <div className="space-y-3 mb-10 border-b border-[var(--border-hairline)] pb-6">
                    <h1 className="text-[clamp(1.6rem,3.5vw,2.5rem)] font-extrabold uppercase tracking-tight text-[var(--text-primary)]">{title}</h1>
                    <p className="text-base text-[var(--text-secondary)] max-w-2xl">{subtitle}</p>
                </div>
                {children}
            </main>
        </div>
    );
};

// Shared marketing building blocks, reused across all four info pages.

function StatRow({ items }: { items: { value: string; label: string }[] }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border-hairline)] border border-[var(--border-hairline)] rounded-xl overflow-hidden">
            {items.map((it) => (
                <div key={it.label} className="bg-[var(--surface-panel)] p-6 text-center space-y-1">
                    <div className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">{it.value}</div>
                    <div className="text-sm font-mono uppercase tracking-wide text-[var(--text-tertiary)]">{it.label}</div>
                </div>
            ))}
        </div>
    );
}

function SplitSection({ eyebrow, heading, description, bullets, image, imageAlt, frameLabel, badge, reverse }: {
    eyebrow: string; heading: string; description: string; bullets: string[];
    image: string; imageAlt: string; frameLabel: string; badge?: { value: string; label: string }; reverse?: boolean;
}) {
    return (
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
            <div className="space-y-5">
                <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{eyebrow}</span>
                <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">{heading}</h2>
                <p className="text-base leading-relaxed text-[var(--text-secondary)]">{description}</p>
                <ul className="space-y-3 pt-2">
                    {bullets.map((b) => (
                        <li key={b} className="flex gap-3 text-sm text-[var(--text-secondary)]">
                            <span className="w-1.5 h-1.5 mt-2.5 rounded-full bg-[var(--surface-invert)] shrink-0" aria-hidden="true" />
                            {b}
                        </li>
                    ))}
                </ul>
            </div>
            <div className="relative">
                <BrowserFrame base={image} alt={imageAlt} label={frameLabel} />
                {badge && (
                    <div className="absolute -bottom-6 -left-6 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-xl p-5 shadow-xl hidden sm:block">
                        <div className="text-xl font-extrabold">{badge.value}</div>
                        <div className="text-sm font-mono uppercase tracking-wide opacity-70">{badge.label}</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
    return (
        <div className="border border-[var(--border-hairline)] rounded-2xl divide-y divide-[var(--border-hairline)] bg-[var(--surface-panel)] overflow-hidden">
            {items.map((it) => (
                <details key={it.q} className="group p-6">
                    <summary className="cursor-pointer list-none flex justify-between items-center gap-4 font-bold text-base text-[var(--text-primary)]">
                        {it.q}
                        <span className="shrink-0 w-6 h-6 rounded-full border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-secondary)] group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
                    </summary>
                    <p className="pt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{it.a}</p>
                </details>
            ))}
        </div>
    );
}

function DarkCta({ heading, sub }: { heading: string; sub: string }) {
    const navigate = useNavigate();
    return (
        <div className="bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-2xl p-8 lg:p-12 text-center space-y-5">
            <h2 className="text-xl lg:text-3xl font-extrabold uppercase tracking-tight">{heading}</h2>
            <p className="text-base opacity-80 max-w-xl mx-auto">{sub}</p>
            <button
                onClick={() => navigate('/login')}
                className="px-8 py-3 font-mono text-sm font-semibold bg-[var(--surface-app)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
            >
                Start Testing Free
            </button>
        </div>
    );
}

// Rendered straight from the shared catalog the engine gates on; a local copy
// silently drifted from what the profiles actually do.
function ProfileTabs() {
    const [active, setActive] = useState(0);
    const profile = INFILTRATION_PROFILE_CATALOG[active];
    return (
        <div className="border border-[var(--border-hairline)] rounded-2xl overflow-hidden bg-[var(--surface-panel)]">
            <div className="flex overflow-x-auto border-b border-[var(--border-hairline)] scroll-rail" role="tablist">
                {INFILTRATION_PROFILE_CATALOG.map((p, i) => (
                    <button
                        key={p.id}
                        role="tab"
                        aria-selected={active === i}
                        onClick={() => setActive(i)}
                        className={`px-5 py-4 font-mono text-sm font-semibold uppercase whitespace-nowrap border-b-2 transition-colors bg-transparent cursor-pointer ${active === i ? 'border-[var(--text-primary)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
            <div className="p-8">
                <h3 className="font-bold text-lg mb-2 text-[var(--text-primary)]">{profile.label}</h3>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)] max-w-2xl">
                    {profile.description}
                    {profile.id === DEFAULT_INFILTRATION_PROFILE ? ' The default profile.' : ''}
                </p>
            </div>
        </div>
    );
}

const BUG_TAXONOMY = [
    ['Forms that accept bad input', 'Forms'],
    ['Rules enforced only in the browser', 'Security'],
    ['Database injection attacks', 'Security'],
    ['Actions that clash when rushed', 'Timing'],
    ['Crashes and unhandled errors', 'Stability'],
    ['Broken responses from the server', 'Backend'],
    ['Failures under heavy load', 'Load'],
    ['Unexpected input breaking the page', 'Input'],
    ['One failure knocking out others', 'Stability'],
    ['Trusting the browser too much', 'Security'],
    ['Frozen, unresponsive screens', 'Stability'],
];

function BugTaxonomyGrid() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {BUG_TAXONOMY.map(([name, tag]) => (
                <div key={name} className="flex items-center justify-between gap-3 px-4 py-3 border border-[var(--border-hairline)] rounded-lg bg-[var(--surface-inset)]">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{name}</span>
                    <span className="font-mono text-sm text-[var(--text-tertiary)] shrink-0 uppercase">{tag}</span>
                </div>
            ))}
        </div>
    );
}

function IconTile({ children }: { children: React.ReactNode }) {
    return (
        <div className="w-12 h-12 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center shrink-0">
            {children}
        </div>
    );
}

// Thesis team; roles intentionally omitted since the project defines none.
const TEAM_MEMBERS = [
    { name: 'John Angelo Marasigan', initials: 'JM' },
    { name: 'Ayan Torreda', initials: 'AT' },
    { name: 'Karen Dela Cerna', initials: 'KD' },
    { name: 'Analyn Caña', initials: 'AC' },
];

function TeamGrid() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {TEAM_MEMBERS.map((m) => (
                <div key={m.name} className="flex flex-col items-center text-center gap-4 p-6 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-panel)] shadow-sm">
                    <div className="w-16 h-16 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center font-mono text-lg font-bold" aria-hidden="true">
                        {m.initials}
                    </div>
                    <div className="font-bold text-sm text-[var(--text-primary)] [text-wrap:balance]">{m.name}</div>
                </div>
            ))}
        </div>
    );
}

export function ExploreContent() {
    return (
        <div className="space-y-12">
            <SplitSection
                eyebrow="No Setup Needed"
                heading="No Test Scripts. No Wiring. Just Go."
                description="At every step, BugSafari looks at your live page and finds everything a real person could interact with, such as buttons, links, menus, and form fields. It skips anything hidden or off-screen, so it only tests what matters."
                bullets={[
                    'Knows when a popup or dialog is open and works with it instead of getting confused.',
                    'Handles busy, crowded pages without missing the controls that count.',
                    'Stays fast even on large apps by keeping every scan short and focused.',
                ]}
                image="product-dashboard"
                imageAlt="The BugSafari dashboard, ready to start a test"
                frameLabel="BugSafari: Live Dashboard"
                badge={{ value: '0', label: 'Setup Steps' }}
            />

            <StatRow items={[
                { value: '11', label: 'Types of bugs caught' },
                { value: '5', label: 'Ways to test' },
                { value: 'Live', label: 'Results as it runs' },
                { value: '0', label: 'Scripts to write' },
            ]} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-inset)] space-y-4">
                    <IconTile><Target className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></IconTile>
                    <h3 className="text-lg font-bold uppercase tracking-tight text-[var(--text-primary)]">Focuses On What Matters</h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">It steers toward the riskiest parts of your app first, like logins, forms, and submits, the actions most likely to hide a real problem, instead of clicking around at random.</p>
                </div>
                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-inset)] space-y-4">
                    <IconTile><Map className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></IconTile>
                    <h3 className="text-lg font-bold uppercase tracking-tight text-[var(--text-primary)]">Explores Everywhere</h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">It keeps a map of where it has been and steers toward the screens it hasn't seen yet, so more of your app gets covered in every run.</p>
                </div>
                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-inset)] space-y-4">
                    <IconTile><History className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></IconTile>
                    <h3 className="text-lg font-bold uppercase tracking-tight text-[var(--text-primary)]">Remembers Where It's Been</h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">It recognizes screens it has already visited, so it never wastes time testing the same thing twice and keeps moving toward something new.</p>
                </div>
                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-inset)] space-y-4">
                    <IconTile><Ban className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></IconTile>
                    <h3 className="text-lg font-bold uppercase tracking-tight text-[var(--text-primary)]">Never Gets Stuck</h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">Built-in limits stop it from clicking the same dead end over and over, so every run keeps making real progress instead of spinning in circles.</p>
                </div>
            </div>

            <div className="space-y-6">
                <div className="space-y-2">
                    <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Testing Modes</span>
                    <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">One App, Five Ways To Test It</h2>
                    <p className="text-base text-[var(--text-secondary)] max-w-2xl">Pick a mode and BugSafari focuses on one kind of problem, from throwing tricky data at your forms to stress-testing what happens under pressure.</p>
                </div>
                <ProfileTabs />
            </div>

            <FaqAccordion items={[
                { q: 'Do I need to write test scripts?', a: 'No. BugSafari finds things to test on its own, straight from your live app. There is nothing to write or set up first.' },
                { q: 'How does it avoid clicking the same button forever?', a: 'It keeps track of where it has been and steers toward new screens, with built-in limits that stop it circling the same dead end.' },
                { q: 'Can a run wander off my site?', a: 'You can lock a run to a single site. When that is on, BugSafari stays put and never follows links off your app.' },
                { q: 'What happens when it has seen everything?', a: 'Once it has tried everything it can find, it makes a couple more passes to be thorough, then finishes and hands you the report.' },
            ]} />

            <DarkCta heading="Watch It Explore Your App" sub="Point BugSafari at your app and see it find, test, and report bugs in real time." />
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
        <div className="space-y-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-panel)] shadow-sm space-y-4 flex flex-col justify-between">
                    <div>
                        <IconTile><Radar className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></IconTile>
                        <h3 className="text-lg font-bold uppercase tracking-tight mt-5 mb-2 text-[var(--text-primary)]">Tests Itself</h3>
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">BugSafari finds every button, link, and form on its own and tries each one, with no test script or setup required.</p>
                    </div>
                    <div className="pt-4 border-t border-[var(--border-hairline)] font-mono text-sm font-bold uppercase text-[var(--text-tertiary)]">Zero Setup</div>
                </div>

                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-panel)] shadow-sm space-y-4 flex flex-col justify-between">
                    <div>
                        <IconTile><Brain className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></IconTile>
                        <h3 className="text-lg font-bold uppercase tracking-tight mt-5 mb-2 text-[var(--text-primary)]">Learns As It Goes</h3>
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">It watches what happens after each action and adjusts which controls it favors, getting better at spotting where bugs are most likely to hide.</p>
                    </div>
                    <div className="pt-4 border-t border-[var(--border-hairline)] font-mono text-sm font-bold uppercase text-[var(--text-tertiary)]">Gets Smarter</div>
                </div>

                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-panel)] shadow-sm space-y-4 flex flex-col justify-between">
                    <div>
                        <IconTile><ClipboardCheck className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></IconTile>
                        <h3 className="text-lg font-bold uppercase tracking-tight mt-5 mb-2 text-[var(--text-primary)]">Proves What Broke</h3>
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">Every confirmed bug comes with the exact steps to reproduce it, so you can see the problem yourself and confirm the fix later.</p>
                    </div>
                    <div className="pt-4 border-t border-[var(--border-hairline)] font-mono text-sm font-bold uppercase text-[var(--text-tertiary)]">Reproduce &amp; Verify</div>
                </div>
            </div>

            <SplitSection
                eyebrow="Testing Modes"
                heading="Five Ways To Stress Your App"
                description="Each mode focuses on a different kind of problem, so you can aim a run at exactly what you're worried about, from tricky form input to what happens under pressure."
                bullets={[
                    'Throws tricky and unexpected data at your forms to see what slips through.',
                    'Checks whether the rules you set in the browser are actually enforced on the server.',
                    'Interrupts actions mid-way to catch timing bugs that only show up under pressure.',
                ]}
                image="product-config"
                imageAlt="The BugSafari configuration modal showing its five testing modes"
                frameLabel="BugSafari: Testing Configuration"
                reverse
            />

            <div>
                <div className="mb-6 space-y-2">
                    <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Testing Modes</span>
                    <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">Pick A Mode, Not A Script</h2>
                </div>
                <ProfileTabs />
            </div>

            <div className="border border-[var(--border-hairline)] rounded-2xl p-6 lg:p-10 bg-[var(--surface-inset)] space-y-6">
                <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">More Ways It Helps You</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="flex gap-4 items-start bg-[var(--surface-panel)] p-6 rounded-xl border border-[var(--border-hairline)]">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><Filter className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base text-[var(--text-primary)]">Only Reports Real Bugs</h3>
                            <p className="text-sm text-[var(--text-secondary)]">It tells the difference between a real problem in your app and noise from the browser or network, so you're not chasing false alarms.</p>
                        </div>
                    </div>
                    <div className="flex gap-4 items-start bg-[var(--surface-panel)] p-6 rounded-xl border border-[var(--border-hairline)]">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><Scale className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base text-[var(--text-primary)]">Consistent Results</h3>
                            <p className="text-sm text-[var(--text-secondary)]">The same problem always gets the same label, a clear severity, and plain advice on how to fix it, every single time.</p>
                        </div>
                    </div>
                    <div className="flex gap-4 items-start bg-[var(--surface-panel)] p-6 rounded-xl border border-[var(--border-hairline)]">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><RefreshCcw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base text-[var(--text-primary)]">Verify Your Fix</h3>
                            <p className="text-sm text-[var(--text-secondary)]">After you patch a bug, replay it to confirm it's actually gone, with no guessing whether the fix worked.</p>
                        </div>
                    </div>
                    <div className="flex gap-4 items-start bg-[var(--surface-panel)] p-6 rounded-xl border border-[var(--border-hairline)]">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><Lock className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base text-[var(--text-primary)]">Stay On Your Site</h3>
                            <p className="text-sm text-[var(--text-secondary)]">Lock a run to a single site so it never wanders off to somewhere you didn't mean to test.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                <div className="space-y-2">
                    <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">What It Catches</span>
                    <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">The Kinds Of Bugs It Finds</h2>
                    <p className="text-base text-[var(--text-secondary)] max-w-2xl">From broken forms to security gaps, every bug comes with a clear label and plain advice on how to fix it.</p>
                </div>
                <BugTaxonomyGrid />
            </div>

            <DarkCta heading="See Everything It Can Do" sub="Run BugSafari against your own app and watch it find, prove, and report bugs in one session." />
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
        <div className="space-y-12">
            <SplitSection
                eyebrow="Who It's For"
                heading="Built For Builders On A Deadline"
                description="BugSafari is made for students and independent developers who need quick, honest feedback before a demo, a submission, or a launch. It works like a tireless tester that finds the big problems early and leaves you enough detail to actually understand them."
                bullets={[
                    'No QA team needed. One person can run it, read the report, and know exactly what broke and why.',
                    'Guest mode lets anyone try a full test on their own app with no signup.',
                    'Sign up to save your history, export your results, and re-check a fix later.',
                ]}
                image="product-history"
                imageAlt="The BugSafari history view listing saved runs with severity"
                frameLabel="BugSafari: Run History"
                badge={{ value: '0', label: 'Setup Steps To Try' }}
            />

            <div className="border border-[var(--border-hairline)] rounded-2xl p-6 lg:p-10 bg-[var(--surface-inset)] space-y-6">
                <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">How It Fits Your Workflow</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="p-6 bg-[var(--surface-panel)] border border-[var(--border-hairline)] rounded-xl space-y-2">
                        <div className="w-10 h-10 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center"><Settings className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="font-bold text-base text-[var(--text-primary)]">Set Up</h3>
                        <p className="text-sm text-[var(--text-secondary)]">Enter your app's address and pick how you want it tested. Optionally lock the run to that one site.</p>
                    </div>
                    <div className="p-6 bg-[var(--surface-panel)] border border-[var(--border-hairline)] rounded-xl space-y-2">
                        <div className="w-10 h-10 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center"><Play className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="font-bold text-base text-[var(--text-primary)]">Start</h3>
                        <p className="text-sm text-[var(--text-secondary)]">One click starts the test. Pause or resume anytime without losing your progress.</p>
                    </div>
                    <div className="p-6 bg-[var(--surface-panel)] border border-[var(--border-hairline)] rounded-xl space-y-2">
                        <div className="w-10 h-10 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center"><Eye className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="font-bold text-base text-[var(--text-primary)]">Watch</h3>
                        <p className="text-sm text-[var(--text-secondary)]">See bugs, network activity, and errors stream in live as BugSafari explores your app.</p>
                    </div>
                    <div className="p-6 bg-[var(--surface-panel)] border border-[var(--border-hairline)] rounded-xl space-y-2">
                        <div className="w-10 h-10 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center"><CheckCircle2 className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="font-bold text-base text-[var(--text-primary)]">Verify</h3>
                        <p className="text-sm text-[var(--text-secondary)]">Save the run, read the report, and re-check any bug after you fix it.</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-panel)] shadow-sm space-y-4">
                    <div className="w-10 h-10 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center"><Rocket className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                    <h3 className="text-lg font-bold uppercase tracking-tight text-[var(--text-primary)]">Try Before You Sign Up</h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">Guest mode runs a full live test with the same dashboard as a full account. Guest runs aren't saved after your session ends.</p>
                </div>
                <div className="p-8 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-panel)] shadow-sm space-y-4">
                    <div className="w-10 h-10 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center"><ShieldCheck className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                    <h3 className="text-lg font-bold uppercase tracking-tight text-[var(--text-primary)]">Your Results Stay Yours</h3>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">Every saved run and report belongs only to your account. Search it, export it, and come back to re-check it whenever you need to.</p>
                </div>
            </div>

            <FaqAccordion items={[
                { q: 'Do I need an account to try it?', a: 'No. Guest mode lets you run a full live test with the same dashboard and report as a full account. Your run just isn\'t saved.' },
                { q: 'What do I get by signing up?', a: 'Saved history you can search, a full report for each run, export to a file, and the ability to re-check a bug after you fix it.' },
                { q: 'Is my data kept separate from other users?', a: 'Yes. Every saved run and report is tied to your account and only visible to you.' },
            ]} />

            <DarkCta heading="Bring Your Own App" sub="Prepping a demo tonight or hardening something before launch? Start a run and see what BugSafari finds." />
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
        <div className="space-y-12">
            <div className="space-y-6 text-[var(--text-secondary)] leading-relaxed text-base max-w-4xl">
                <p>BugSafari started with a simple frustration: modern web apps hide small, sneaky problems like broken forms, timing glitches, and security gaps that normal tests never think to try. And random "just click everything" tools make a mess without telling you what went wrong.</p>
                <p>So we built something in between: a tester that explores your app like a curious user, learns where trouble is likely to hide, pushes your app the way real users eventually will, and turns whatever breaks into a clear, repeatable report, with nothing for you to script or set up.</p>
            </div>

            <SplitSection
                eyebrow="What Makes It Different"
                heading="A Tester That Thinks"
                description="Instead of following a fixed script, BugSafari decides where to go next, tries the things a real user would, and keeps proof of everything it finds."
                bullets={[
                    'It focuses on the risky parts of your app instead of clicking at random.',
                    'It remembers where it has been, so it covers more without repeating itself.',
                    'It captures exactly what happened, so every bug can be reproduced.',
                ]}
                image="product-live"
                imageAlt="The BugSafari dashboard streaming telemetry during a live test"
                frameLabel="BugSafari: Telemetry Stream"
            />

            <div className="border border-[var(--border-hairline)] rounded-2xl p-6 lg:p-10 bg-[var(--surface-panel)] shadow-sm space-y-6">
                <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">What We Care About</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><BadgeCheck className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base uppercase tracking-tight text-[var(--text-primary)]">Honest Results</h3>
                            <p className="text-sm text-[var(--text-secondary)]">It only reports real problems in your app, not noise from the browser or the network, so you never chase false alarms.</p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><ListChecks className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base uppercase tracking-tight text-[var(--text-primary)]">Clear Answers</h3>
                            <p className="text-sm text-[var(--text-secondary)]">Every bug comes with a plain label, a severity, and simple advice on how to fix it, with no decoding required.</p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><ShieldCheck className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base uppercase tracking-tight text-[var(--text-primary)]">Nothing Breaks The Run</h3>
                            <p className="text-sm text-[var(--text-secondary)]">One failing test never takes down the rest. The run keeps going and still hands you a complete report.</p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-[var(--surface-invert)] text-[var(--text-oninvert)] flex items-center justify-center shrink-0"><Lock className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-base uppercase tracking-tight text-[var(--text-primary)]">Your Data Is Yours</h3>
                            <p className="text-sm text-[var(--text-secondary)]">Saved runs and reports stay tied to your account and out of everyone else's reach.</p>
                        </div>
                    </div>
                </div>
            </div>

            <StatRow items={[
                { value: '11', label: 'Bug types caught' },
                { value: '5', label: 'Testing modes' },
                { value: 'Live', label: 'Real-time results' },
                { value: '0', label: 'Scripts to write' },
            ]} />

            <div className="border border-[var(--border-hairline)] rounded-2xl p-6 lg:p-10 bg-[var(--surface-inset)] space-y-6">
                <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">Who We Build For</h2>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)] max-w-3xl">
                    BugSafari is made for students and independent developers who need quick, honest feedback before a demo, a submission, or a launch. It works like a tireless tester that finds the big problems early and leaves you enough detail to understand exactly what happened, not just that something broke.
                </p>
            </div>

            <div className="space-y-6">
                <div className="space-y-2">
                    <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Thesis Team</span>
                    <h2 className="text-xl lg:text-2xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">The People Behind BugSafari</h2>
                    <p className="text-base text-[var(--text-secondary)] max-w-2xl">BugSafari was designed and built as an undergraduate thesis project by four students.</p>
                </div>
                <TeamGrid />
            </div>

            <DarkCta heading="Put It To Work" sub="Start a free run and see what BugSafari finds in your own app." />
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
