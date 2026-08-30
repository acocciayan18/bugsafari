import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radar, Brain, ClipboardCheck, Link2, Play, Eye, FileText, Sun, Moon, Menu, X } from 'lucide-react';
import { ExploreContent, FeaturesContent, CommunityContent, AboutContent } from '../pages/InfoPages';
import { SECTION_META } from '../pages/sectionMeta';
import WelcomeModal from '../components/common/WelcomeModal';
import { LegalDocModal } from '../components/legal/LegalDocModal';
import type { LegalDocId } from '../legal/content';
import { useWelcomeNotice } from '../hooks/useWelcomeNotice';
import { useDarkMode } from '../context/DarkModeContext';
import { BrowserFrame } from '../components/marketing/ProductShot';

type SectionId = 'home' | 'explore' | 'features' | 'community' | 'about';

const featureCards = [
    {
        icon: Radar,
        title: 'Tests Itself',
        description:
            'Point BugSafari at your app and it explores on its own, clicking buttons, filling forms, and following links like a real user. You never write a test script.',
    },
    {
        icon: Brain,
        title: 'Learns As It Goes',
        description:
            'It weighs each control it finds and steers toward the parts most likely to break, such as logins, forms, and submits, instead of clicking at random.',
    },
    {
        icon: ClipboardCheck,
        title: 'Shows What Broke',
        description:
            'Every confirmed bug comes with a reproduction guide and a plain-language suggested fix, so you know exactly what to change.',
    },
];

const howItWorks = [
    { icon: Link2, title: 'Add Your App', description: 'Paste the web address of the app you want to test.' },
    { icon: Play, title: 'Press Start', description: 'Click once and BugSafari starts exploring. Pause or resume anytime.' },
    { icon: Eye, title: 'Watch It Explore', description: 'See every click, form, and result stream in live.' },
    { icon: FileText, title: 'Get Your Report', description: 'Review each bug it found, with steps to reproduce and a suggested fix.' },
];

const trustStats = [
    { value: '11', label: 'Types of bugs caught' },
    { value: '5', label: 'Ways to test your app' },
    { value: '0', label: 'Test scripts to write' },
    { value: 'Free', label: 'To try, no signup' },
];

const homeFaqs = [
    { q: 'Do I need to write any test code?', a: 'No. BugSafari explores your app by itself and finds things to test as it goes. There is nothing to script or set up first.' },
    { q: 'Can I try it without signing up?', a: 'Yes. Guest mode runs a full live test on your own app with no account needed. Sign up later if you want to save your results.' },
    { q: 'What kind of apps does it work on?', a: 'Modern web apps that run in the browser, the kind built with React, Vue, Angular, and similar tools.' },
    { q: 'Will it change or break my app?', a: 'It only interacts with what any visitor could. You point it at your own test or staging site and watch everything it does, live.' },
];

const NAV_ITEMS: { id: SectionId; label: string }[] = [
    { id: 'explore', label: 'How It Works' },
    { id: 'features', label: 'Features' },
    { id: 'community', label: "Who It's For" },
    { id: 'about', label: 'About' },
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

// Static marketing home; memoized since it never depends on activeSection.
const HomeSection = memo(function HomeSection({ onLogin }: { onLogin: () => void }) {
    return (
        <>
            {/* Hero */}
            <section className="relative overflow-hidden px-6 py-14 lg:py-20">
                <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="relative z-10 min-w-0 space-y-6">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-[var(--border-hairline)] bg-[var(--surface-panel)] rounded-full">
                            <span className="font-mono text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Automated App Testing</span>
                        </div>
                        <h1 className="text-[clamp(1.75rem,4vw,3rem)] leading-[1.1] font-extrabold uppercase tracking-tight text-[var(--text-primary)] [text-wrap:balance]">
                            Find Bugs <span className="text-[var(--text-tertiary)]">Before Your Users Do.</span>
                        </h1>
                        <p className="text-base leading-relaxed text-[var(--text-secondary)] max-w-xl">
                            BugSafari explores your web app on its own, clicking, typing, and stress-testing it like a real user. It then hands you a clear report of everything that broke, with steps to reproduce it. No test scripts required.
                        </p>
                        <div className="flex flex-wrap gap-4 pt-1">
                            <button
                                onClick={onLogin}
                                className="px-8 py-3.5 bg-[var(--surface-invert)] text-[var(--text-oninvert)] font-semibold rounded-lg shadow-md hover:bg-[var(--surface-invert-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] cursor-pointer"
                            >
                                Try It Free
                            </button>
                        </div>
                        <p className="font-mono text-sm font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">No signup needed to try • Free guest mode</p>
                    </div>

                    <div className="relative min-w-0">
                        <BrowserFrame base="product-dashboard" alt="The BugSafari dashboard, ready to start a test run" label="BugSafari: Live Dashboard" />
                    </div>
                </div>
            </section>

            {/* Trust indicators */}
            <section className="px-6 pb-14">
                <div className="max-w-[1280px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border-hairline)] border border-[var(--border-hairline)] rounded-xl overflow-hidden">
                    {trustStats.map((stat) => (
                        <div key={stat.label} className="bg-[var(--surface-panel)] p-6 text-center space-y-1">
                            <div className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">{stat.value}</div>
                            <div className="text-sm font-mono uppercase tracking-wide text-[var(--text-tertiary)]">{stat.label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Feature highlights */}
            <section className="py-16 lg:py-20 px-6">
                <div className="max-w-[1280px] mx-auto">
                    <div className="text-center mb-12 space-y-3">
                        <h2 className="text-2xl lg:text-3xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">Testing That Runs Itself</h2>
                        <p className="text-base text-[var(--text-secondary)] max-w-2xl mx-auto">Catch the bugs your users would find, without writing a single test. BugSafari does the exploring so you can focus on building.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {featureCards.map((card) => (
                            <div key={card.title} className="p-7 border border-[var(--border-hairline)] rounded-xl bg-[var(--surface-panel)] shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                                <div className="w-12 h-12 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center mb-5 shrink-0">
                                    <card.icon className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" />
                                </div>
                                <h3 className="text-lg mb-3 font-bold uppercase tracking-tight text-[var(--text-primary)]">{card.title}</h3>
                                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{card.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section className="py-16 lg:py-20 px-6 bg-[var(--surface-inset)] border-y border-[var(--border-hairline)]">
                <div className="max-w-[1280px] mx-auto space-y-12">
                    <div className="text-center space-y-3">
                        <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">How It Works</span>
                        <h2 className="text-2xl lg:text-3xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">From App To Bug Report In Four Steps</h2>
                        <p className="text-base text-[var(--text-secondary)] max-w-2xl mx-auto">No setup and no scripts. Get real results in minutes.</p>
                    </div>
                    <ol className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {howItWorks.map((item, i) => (
                            <li key={item.title} className="p-6 bg-[var(--surface-panel)] border border-[var(--border-hairline)] rounded-xl space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="w-10 h-10 bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg flex items-center justify-center">
                                        <item.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                                    </div>
                                    <span className="font-mono text-sm font-bold text-[var(--text-tertiary)]">0{i + 1}</span>
                                </div>
                                <h3 className="text-base font-bold uppercase tracking-tight text-[var(--text-primary)]">{item.title}</h3>
                                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{item.description}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {/* Watch it live */}
            <section className="py-16 lg:py-20 px-6">
                <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="space-y-5">
                        <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">See It In Action</span>
                        <h2 className="text-2xl lg:text-3xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">Watch Every Step, Live</h2>
                        <p className="text-base leading-relaxed text-[var(--text-secondary)]">Follow along as BugSafari explores your app in real time. See what it clicks, what it types, and the moment something breaks, all on one dashboard, with telemetry, findings, network, and console in separate tabs.</p>
                        <ul className="space-y-4">
                            <li className="flex items-start gap-3">
                                <span className="font-mono text-sm font-bold bg-[var(--surface-invert)] text-[var(--text-oninvert)] w-6 h-6 rounded-full flex items-center justify-center mt-0.5 shrink-0" aria-hidden="true">✓</span>
                                <p className="text-sm text-[var(--text-secondary)]">Every action and result streams in as it happens, nothing hidden.</p>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="font-mono text-sm font-bold bg-[var(--surface-invert)] text-[var(--text-oninvert)] w-6 h-6 rounded-full flex items-center justify-center mt-0.5 shrink-0" aria-hidden="true">✓</span>
                                <p className="text-sm text-[var(--text-secondary)]">It keeps finding new ground instead of getting stuck in circles.</p>
                            </li>
                        </ul>
                    </div>
                    <BrowserFrame base="product-live" alt="The BugSafari dashboard streaming telemetry during a live test" label="BugSafari: Telemetry Stream" />
                </div>
            </section>

            {/* Findings proof */}
            <section className="py-16 lg:py-20 px-6 bg-[var(--surface-inset)] border-y border-[var(--border-hairline)]">
                <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="order-2 lg:order-1">
                        <BrowserFrame base="product-findings" alt="A confirmed BugSafari finding with reproduction guide and suggested fix" label="BugSafari: Finding Detail" />
                    </div>
                    <div className="order-1 lg:order-2 space-y-5">
                        <span className="font-mono text-sm font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Proof, Not Guesses</span>
                        <h2 className="text-2xl lg:text-3xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">Every Bug Comes With A Guide</h2>
                        <p className="text-base leading-relaxed text-[var(--text-secondary)]">Each confirmed finding carries a severity, the element and message involved, a step-by-step reproduction guide, and a plain suggested fix, so you can see the problem yourself and confirm it's gone after you patch it.</p>
                    </div>
                </div>
            </section>

            {/* FAQ */}
            <section className="py-16 lg:py-20 px-6">
                <div className="max-w-3xl mx-auto space-y-8">
                    <div className="text-center space-y-3">
                        <h2 className="text-2xl lg:text-3xl font-extrabold uppercase tracking-tight text-[var(--text-primary)]">Common Questions</h2>
                    </div>
                    <div className="border border-[var(--border-hairline)] rounded-2xl divide-y divide-[var(--border-hairline)] bg-[var(--surface-panel)] overflow-hidden">
                        {homeFaqs.map((it) => (
                            <details key={it.q} className="group p-6">
                                <summary className="cursor-pointer list-none flex justify-between items-center gap-4 font-bold text-base text-[var(--text-primary)]">
                                    {it.q}
                                    <span className="shrink-0 w-6 h-6 rounded-full border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-secondary)] group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
                                </summary>
                                <p className="pt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{it.a}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="py-20 px-6 text-center bg-[var(--surface-inset)] border-t border-[var(--border-hairline)]">
                <div className="max-w-3xl mx-auto space-y-6">
                    <h2 className="text-[clamp(1.6rem,3vw,2.25rem)] font-extrabold uppercase tracking-tight text-[var(--text-primary)]">Ready To Catch More Bugs?</h2>
                    <p className="text-base text-[var(--text-secondary)]">Point BugSafari at your app and watch it work. It is free to try, with no signup, no scripts, and no setup.</p>
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <button
                            onClick={onLogin}
                            className="px-10 py-4 bg-[var(--surface-invert)] text-[var(--text-oninvert)] font-semibold rounded-lg shadow-md hover:bg-[var(--surface-invert-hover)] transition-colors uppercase tracking-wide text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] cursor-pointer"
                        >
                            Start Testing Free
                        </button>
                    </div>
                </div>
            </section>
        </>
    );
});

// Non-home sections share one header shape; content reused from InfoPages so route pages stay in sync.
const InfoSection = memo(function InfoSection({ id }: { id: Exclude<SectionId, 'home'> }) {
    const meta = SECTION_META[id];
    return (
        <div className="pt-8 pb-8 px-6 max-w-[1280px] mx-auto">
            <div className="space-y-3 mb-10 border-b border-[var(--border-hairline)] pb-6">
                <h1 className="text-[clamp(1.6rem,3.5vw,2.5rem)] font-extrabold uppercase tracking-tight text-[var(--text-primary)]">{meta.title}</h1>
                <p className="text-base text-[var(--text-secondary)] max-w-2xl">{meta.subtitle}</p>
            </div>
            {id === 'explore' && <ExploreContent />}
            {id === 'features' && <FeaturesContent />}
            {id === 'community' && <CommunityContent />}
            {id === 'about' && <AboutContent />}
        </div>
    );
});

const LandingPage = () => {
    const navigate = useNavigate();
    const [activeSection, setActiveSection] = useState<SectionId>('home');
    const [legalDoc, setLegalDoc] = useState<LegalDocId | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const mainRef = useRef<HTMLElement>(null);
    const welcome = useWelcomeNotice();

    const goToSection = useCallback((id: SectionId) => {
        setActiveSection(id);
        setMenuOpen(false);
    }, []);

    // Smooth-scroll to the top of the content on every in-page section switch.
    useEffect(() => {
        mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [activeSection]);

    const goToLogin = useCallback(() => navigate('/login'), [navigate]);

    return (
        <div className="bg-[var(--surface-app)] text-[var(--text-primary)] min-h-screen font-sans selection:bg-[var(--surface-invert)] selection:text-[var(--text-oninvert)]">
            <div className="landing-backdrop" aria-hidden="true" />
            <WelcomeModal isOpen={welcome.isOpen} onDismiss={welcome.dismiss} />
            <LegalDocModal docId={legalDoc} onClose={() => setLegalDoc(null)} />

            {/* Top nav, stays mounted across every in-page section switch */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--surface-app)]/95 backdrop-blur-md border-b border-[var(--border-hairline)]">
                <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1280px] mx-auto">
                    <div className="flex items-center gap-8">
                        <button onClick={() => goToSection('home')} className="text-xl font-extrabold tracking-tighter uppercase text-[var(--text-primary)] bg-transparent border-none cursor-pointer">
                            BUGSAFARI
                        </button>
                        <div className="hidden md:flex items-center gap-6">
                            {NAV_ITEMS.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => goToSection(item.id)}
                                    aria-current={activeSection === item.id ? 'page' : undefined}
                                    className={`font-mono text-sm font-medium transition-colors bg-transparent border-none cursor-pointer ${activeSection === item.id ? 'text-[var(--text-primary)] border-b border-[var(--text-primary)] pb-1' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        
                        <button
                            onClick={goToLogin}
                            className="hidden sm:inline-flex px-5 py-2 font-mono text-sm font-semibold bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg hover:bg-[var(--surface-invert-hover)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none cursor-pointer"
                        >
                            Log In
                        </button>
                        <button
                            onClick={() => navigate('/signup')}
                            className="hidden sm:inline-flex px-5 py-2 font-mono text-sm font-semibold text-[var(--text-primary)] border border-[var(--border-strong)] rounded-lg bg-transparent hover:bg-[var(--surface-hover)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none cursor-pointer"
                        >
                            Sign Up
                        </button>
                        <ThemeToggle />
                        <button
                            onClick={() => setMenuOpen((v) => !v)}
                            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                            aria-expanded={menuOpen}
                            aria-controls="mobile-nav"
                            className="md:hidden touch-target grid place-items-center w-10 h-10 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-panel)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none cursor-pointer"
                        >
                            {menuOpen ? <X className="w-5 h-5" strokeWidth={1.75} /> : <Menu className="w-5 h-5" strokeWidth={1.75} />}
                        </button>
                    </div>
                </div>

                {/* Mobile drawer */}
                {menuOpen && (
                    <div id="mobile-nav" className="md:hidden border-t border-[var(--border-hairline)] bg-[var(--surface-app)] px-6 py-4 space-y-1 animate-fade-in">
                        {NAV_ITEMS.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => goToSection(item.id)}
                                aria-current={activeSection === item.id ? 'page' : undefined}
                                className={`block w-full text-left px-3 py-3 rounded-lg font-mono text-sm font-medium transition-colors cursor-pointer ${activeSection === item.id ? 'bg-[var(--surface-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'}`}
                            >
                                {item.label}
                            </button>
                        ))}
                        <div className="flex gap-3 pt-3">
                            <button
                                onClick={goToLogin}
                                className="flex-1 px-4 py-3 font-mono text-sm font-semibold bg-[var(--surface-invert)] text-[var(--text-oninvert)] rounded-lg hover:bg-[var(--surface-invert-hover)] transition-colors cursor-pointer"
                            >
                                Log In
                            </button>
                            <button
                                onClick={() => { setMenuOpen(false); navigate('/signup'); }}
                                className="flex-1 px-4 py-3 font-mono text-sm font-semibold text-[var(--text-primary)] border border-[var(--border-strong)] rounded-lg bg-transparent hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                            >
                                Sign Up
                            </button>
                        </div>
                    </div>
                )}
            </nav>

            <main ref={mainRef} className="pt-16 scroll-mt-16">
                {activeSection === 'home' ? <HomeSection onLogin={goToLogin} /> : <InfoSection id={activeSection} />}
            </main>

            {/* Footer */}
            <footer className="bg-[var(--surface-app)] border-t border-[var(--border-hairline)]">
                <div className="w-full px-6 py-12 max-w-[1280px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div className="space-y-4">
                        <div className="text-lg font-extrabold uppercase tracking-tighter text-[var(--text-primary)]">BugSafari</div>
                        <p className="text-sm text-[var(--text-secondary)] max-w-xs">
                            © 2026 BugSafari. Automated bug-hunting for your web app. Built for students and independent developers.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 md:gap-12">
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-sm font-extrabold uppercase text-[var(--text-primary)]">Product</span>
                            <button onClick={() => goToSection('explore')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">How It Works</button>
                            <button onClick={() => goToSection('features')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">Features</button>
                            <button onClick={() => goToSection('community')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">Who It's For</button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-sm font-extrabold uppercase text-[var(--text-primary)]">Legal</span>
                            <button onClick={() => setLegalDoc('privacy')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">Privacy Notice</button>
                            <button onClick={() => setLegalDoc('terms')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">Terms of Use</button>
                            <button onClick={() => setLegalDoc('research')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">Research Disclaimer</button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-sm font-extrabold uppercase text-[var(--text-primary)]">Project</span>
                            <button onClick={() => goToSection('about')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">About</button>
                            <button onClick={() => setLegalDoc('licenses')} className="font-mono text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-left bg-transparent border-none cursor-pointer p-0">Licenses</button>
                        </div>
                    </div>
                </div>
                <div className="max-w-[1280px] mx-auto px-6 py-6 border-t border-[var(--border-hairline)] text-center md:text-left">
                    <p className="font-mono text-sm font-bold text-[var(--text-tertiary)]">ONLY TEST APPS YOU OWN OR HAVE PERMISSION TO TEST.</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
