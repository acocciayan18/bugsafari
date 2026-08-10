import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Radar, Brain, ClipboardCheck, Target, Map, History, Ban,
    Filter, Scale, RefreshCcw, Lock, Settings, Play, Eye,
    CheckCircle2, Rocket, ShieldCheck, BadgeCheck, ListChecks,
} from 'lucide-react';
import { SECTION_META } from './sectionMeta';
import { INFILTRATION_PROFILE_CATALOG, DEFAULT_INFILTRATION_PROFILE } from '../types';

const PageShell = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => {
    const navigate = useNavigate();

    return (
        <div className="bg-nova-light text-black min-h-screen font-sans selection:bg-[#121212] selection:text-white">
            {/* Top Navigation Bar */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-nova-light/95 backdrop-blur-md border-b border-zinc-200 shadow-sm">
                <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1440px] mx-auto">
                    <div className="flex items-center gap-8">
                        <button onClick={() => navigate('/')} className="text-[24px] font-extrabold text-black tracking-tighter uppercase text-left bg-transparent border-none cursor-pointer">
                            BUGSAFARI
                        </button>
                        <div className="hidden md:flex items-center gap-6">
                            <button onClick={() => navigate('/explore')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('Works') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>How It Works</button>
                            <button onClick={() => navigate('/features')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('Does') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>Features</button>
                            <button onClick={() => navigate('/community')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('Who') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>Who It's For</button>
                            <button onClick={() => navigate('/about')} className={`font-mono text-[13px] font-semibold transition-colors bg-transparent border-none cursor-pointer ${title.includes('About') ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}>About</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/login')}
                            className="px-5 py-2 font-mono text-[13px] font-semibold bg-[#121212] text-white rounded-lg shadow-sm hover:bg-zinc-800 transition-all focus:ring-2 focus:ring-black focus:outline-none cursor-pointer"
                        >
                            Log In
                        </button>
                    </div>
                </div>
            </nav>

            <main className="pt-6 pb-6 px-6 max-w-[1440px] mx-auto">
                <div className="space-y-3 mb-10 border-b border-zinc-200 pb-6">
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
                    <div className="text-xs font-mono uppercase  text-zinc-500">{it.label}</div>
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
                <span className="font-mono text-xs font-bold text-zinc-400 uppercase st">{eyebrow}</span>
                <h2 className="text-2xl lg:text-3xl font-extrabold uppercase tracking-tight">{heading}</h2>
                <p className="text-zinc-600 leading-relaxed">{description}</p>
                <ul className="space-y-3 pt-2">
                    {bullets.map((b) => (
                        <li key={b} className="flex gap-3 text-[13px] text-zinc-700">
                            <span className="w-1.5 h-1.5 mt-2 rounded-full bg-[#121212] shrink-0" />
                            {b}
                        </li>
                    ))}
                </ul>
            </div>
            <div className="relative">
                <img src={image} alt={imageAlt} className="w-full rounded-xl border border-zinc-200 shadow-lg" />
                {badge && (
                    <div className="absolute -bottom-6 -left-6 bg-[#121212] text-white rounded-xl p-5 shadow-xl hidden sm:block">
                        <div className="text-2xl font-extrabold">{badge.value}</div>
                        <div className="text-xs font-mono uppercase  text-zinc-400">{badge.label}</div>
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
        <div className="bg-[#121212] text-white rounded-2xl p-8 lg:p-12 text-center space-y-5">
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

// Rendered straight from the shared catalog the engine gates on; a local copy
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
    ['Forms that accept bad input', 'Forms'],
    ['Rules enforced only in the browser', 'Security'],
    ['Database injection attacks', 'Security'],
    ['Actions that clash when rushed', 'Timing'],
    ['Pages that trap you in a loop', 'Navigation'],
    ['Crashes and unhandled errors', 'Stability'],
    ['Broken responses from the server', 'Backend'],
    ['Failures under heavy load', 'Load'],
    ['Unexpected input breaking the page', 'Input'],
    ['Leaked private information', 'Security'],
    ['One failure knocking out others', 'Stability'],
    ['Trusting the browser too much', 'Security'],
    ['Endless loading spinners', 'Load'],
    ['Broken page routing', 'Navigation'],
    ['Frozen, unresponsive screens', 'Stability'],
    ['Sessions that fall out of sync', 'Accounts'],
];

function BugTaxonomyGrid() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {BUG_TAXONOMY.map(([name, tag]) => (
                <div key={name} className="flex items-center justify-between gap-3 px-4 py-3 border border-zinc-200 rounded-lg bg-zinc-50/50">
                    <span className="text-[13px] font-semibold">{name}</span>
                    <span className="font-mono text-xs text-zinc-400 shrink-0 uppercase">{tag}</span>
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
                    image="/marketing/dashboard-shell.png"
                    imageAlt="The BugSafari dashboard, ready to start a test"
                    badge={{ value: '0', label: 'Setup Steps' }}
                />

                <StatRow items={[
                    { value: '16', label: 'Types of bugs caught' },
                    { value: '5', label: 'Ways to test' },
                    { value: 'Live', label: 'Results as it runs' },
                    { value: '0', label: 'Scripts to write' },
                ]} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center shrink-0"><Target className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="text-xl font-bold uppercase">Focuses On What Matters</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">It focuses on the riskiest parts of your app first, like logins, payments, and deletes, the actions most likely to hide a real problem, instead of clicking around at random.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center shrink-0"><Map className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="text-xl font-bold uppercase">Explores Everywhere</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">It keeps a map of where it has been and steers toward the screens it hasn't seen yet, so more of your app gets covered in every run.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center shrink-0"><History className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="text-xl font-bold uppercase">Remembers Where It's Been</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">It recognizes screens it has already visited, so it never wastes time testing the same thing twice and keeps moving toward something new.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center shrink-0"><Ban className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="text-xl font-bold uppercase">Never Gets Stuck</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Built-in limits stop it from clicking the same dead end over and over, so every run keeps making real progress instead of spinning in circles.</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="space-y-2">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase st">Testing Modes</span>
                        <h2 className="text-2xl font-extrabold uppercase tracking-tight">One App, Five Ways To Test It</h2>
                        <p className="text-zinc-600 max-w-2xl">Pick a mode and BugSafari focuses on one kind of problem, from throwing tricky data at your forms to stress-testing what happens under pressure.</p>
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
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center mb-6 shrink-0"><Radar className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></div>
                            <h3 className="text-xl font-bold uppercase mb-2">Tests Itself</h3>
                            <p className="text-[13px] text-zinc-600 leading-relaxed">BugSafari finds every button, link, and form on its own and tries each one, with no test script or setup required.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Zero Setup</div>
                    </div>

                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center mb-6 shrink-0"><Brain className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></div>
                            <h3 className="text-xl font-bold uppercase mb-2">Learns As It Goes</h3>
                            <p className="text-[13px] text-zinc-600 leading-relaxed">It watches what happens after each action and gets better at spotting where bugs are most likely to hide in your app.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Gets Smarter</div>
                    </div>

                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center mb-6 shrink-0"><ClipboardCheck className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" /></div>
                            <h3 className="text-xl font-bold uppercase mb-2">Proves What Broke</h3>
                            <p className="text-[13px] text-zinc-600 leading-relaxed">Every bug it finds comes with the exact steps to reproduce it, so you can see the problem yourself and confirm the fix later.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Reproduce &amp; Verify</div>
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
                    image="/marketing/profile-selector.png"
                    imageAlt="The BugSafari setup screen showing its five testing modes"
                    reverse
                />

                <div>
                    <div className="mb-6 space-y-2">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase st">Testing Modes</span>
                        <h2 className="text-2xl font-extrabold uppercase tracking-tight">Pick A Mode, Not A Script</h2>
                    </div>
                    <ProfileTabs />
                </div>

                <div className="border border-zinc-200 rounded-2xl p-6 lg:p-10 bg-zinc-50/50 space-y-6">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">More Ways It Helps You</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><Filter className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Only Reports Real Bugs</h4>
                                <p className="text-[13px] text-zinc-600">It tells the difference between a real problem in your app and noise from the browser or network, so you're not chasing false alarms.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><Scale className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Consistent Results</h4>
                                <p className="text-[13px] text-zinc-600">The same problem always gets the same label, a clear severity, and plain advice on how to fix it, every single time.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><RefreshCcw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Verify Your Fix</h4>
                                <p className="text-[13px] text-zinc-600">After you patch a bug, replay it with one click to confirm it's actually gone, with no guessing whether the fix worked.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><Lock className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Stay On Your Site</h4>
                                <p className="text-[13px] text-zinc-600">Lock a run to a single site so it never wanders off to somewhere you didn't mean to test.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="space-y-2">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase st">What It Catches</span>
                        <h2 className="text-2xl font-extrabold uppercase tracking-tight">The Kinds Of Bugs It Finds</h2>
                        <p className="text-zinc-600 max-w-2xl">From broken forms to security gaps, every bug comes with a clear label and plain advice on how to fix it.</p>
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
                    image="/marketing/dashboard-shell.png"
                    imageAlt="The BugSafari dashboard ready to start a run"
                    badge={{ value: '0', label: 'Setup Steps To Try' }}
                />

                <div className="border border-zinc-200 rounded-2xl p-6 lg:p-10 bg-zinc-50/50 space-y-6">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">How It Fits Your Workflow</h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <div className="w-10 h-10 bg-[#121212] text-white rounded-lg flex items-center justify-center"><Settings className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                            <h4 className="font-bold text-lg">Set Up</h4>
                            <p className="text-xs text-zinc-600">Enter your app's address and pick how you want it tested. Optionally lock the run to that one site.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <div className="w-10 h-10 bg-[#121212] text-white rounded-lg flex items-center justify-center"><Play className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                            <h4 className="font-bold text-lg">Start</h4>
                            <p className="text-xs text-zinc-600">One click starts the test. Pause or resume anytime without losing your progress.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <div className="w-10 h-10 bg-[#121212] text-white rounded-lg flex items-center justify-center"><Eye className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                            <h4 className="font-bold text-lg">Watch</h4>
                            <p className="text-xs text-zinc-600">See bugs, network activity, and errors stream in live as BugSafari explores your app.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <div className="w-10 h-10 bg-[#121212] text-white rounded-lg flex items-center justify-center"><CheckCircle2 className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                            <h4 className="font-bold text-lg">Verify</h4>
                            <p className="text-xs text-zinc-600">Save the run, read the report, and re-check any bug with one click after you fix it.</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4">
                        <div className="w-10 h-10 bg-[#121212] text-white rounded-lg flex items-center justify-center"><Rocket className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="text-xl font-bold uppercase">Try Before You Sign Up</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Guest mode runs the exact same test and live dashboard as a full account. The only difference: guest runs aren't saved after your session ends.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4">
                        <div className="w-10 h-10 bg-[#121212] text-white rounded-lg flex items-center justify-center"><ShieldCheck className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></div>
                        <h3 className="text-xl font-bold uppercase">Your Results Stay Yours</h3>
                        <p className="text-zinc-600 text-[13px] leading-relaxed">Every saved run and report belongs only to your account. Search it, export it, and come back to re-check it whenever you need to.</p>
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
                <div className="space-y-6 text-zinc-700 leading-relaxed text-base max-w-4xl">
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
                    image="/marketing/dashboard-shell.png"
                    imageAlt="The BugSafari dashboard during a live test"
                />

                <div className="border border-zinc-200 rounded-2xl p-6 lg:p-10 bg-white shadow-sm space-y-6">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">What We Care About</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><BadgeCheck className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg text-black uppercase">Honest Results</h4>
                                <p className="text-[13px] text-zinc-600">It only reports real problems in your app, not noise from the browser or the network, so you never chase false alarms.</p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><ListChecks className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg text-black uppercase">Clear Answers</h4>
                                <p className="text-[13px] text-zinc-600">Every bug comes with a plain label, a severity, and simple advice on how to fix it, with no decoding required.</p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><ShieldCheck className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg text-black uppercase">Nothing Breaks The Run</h4>
                                <p className="text-[13px] text-zinc-600">One failing test never takes down the rest. The run keeps going and still hands you a complete report.</p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#121212] text-white flex items-center justify-center shrink-0"><Lock className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /></div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg text-black uppercase">Your Data Is Yours</h4>
                                <p className="text-[13px] text-zinc-600">Saved runs and reports stay tied to your account and out of everyone else's reach.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <StatRow items={[
                    { value: '16', label: 'Bug types caught' },
                    { value: '5', label: 'Testing modes' },
                    { value: 'Live', label: 'Real-time results' },
                    { value: '0', label: 'Scripts to write' },
                ]} />

                <div className="border border-zinc-200 rounded-2xl p-6 lg:p-10 bg-zinc-50/50 space-y-6">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Who We Build For</h2>
                    <p className="text-[13px] text-zinc-600 leading-relaxed max-w-3xl">
                        BugSafari is made for students and independent developers who need quick, honest feedback before a demo, a submission, or a launch. It works like a tireless tester that finds the big problems early and leaves you enough detail to understand exactly what happened, not just that something broke.
                    </p>
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
