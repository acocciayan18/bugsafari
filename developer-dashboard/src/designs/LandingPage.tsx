import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExploreContent, FeaturesContent, CommunityContent, AboutContent } from '../pages/InfoPages';
import { SECTION_META } from '../pages/sectionMeta';
import WelcomeModal from '../components/common/WelcomeModal';
import { LegalDocModal } from '../components/legal/LegalDocModal';
import type { LegalDocId } from '../legal/content';
import { useWelcomeNotice } from '../hooks/useWelcomeNotice';

type SectionId = 'home' | 'explore' | 'features' | 'community' | 'about';

const featureCards = [
    {
        tag: 'AI',
        title: 'Scriptless Traversal',
        description:
            'A recursive DOM parser discovers every interactive element on your SPA live, with no manual test script, selector list, or hand-authored path.',
    },
    {
        tag: 'ML',
        title: 'Adaptive Intelligence',
        description:
            'A self-learning perceptron scores every candidate and updates its weights after each observed outcome — a fault, a network call, a repeated state.',
    },
    {
        tag: 'RT',
        title: 'Real-time Forensics',
        description:
            'A 20-step circular action buffer and narrated reproduction steps capture what happened, so any saved finding can be deterministically replayed.',
    },
];

const deepTraceChecks = [
    {
        title: 'State Graph Navigation',
        description: 'Track every transition across a bounded 500-node state graph, biasing toward unexplored edges.',
    },
    {
        title: 'Five-Layer Loop Prevention',
        description: 'Repeat-strikes, look-ahead, ancestor-hash dedup, per-edge budgets, and route-exhaustion keep runs off dead ends.',
    },
];

const NAV_ITEMS: { id: SectionId; label: string }[] = [
    { id: 'explore', label: 'Explore' },
    { id: 'features', label: 'Features' },
    { id: 'community', label: 'Community' },
    { id: 'about', label: 'About' },
];

// Static marketing sections — memoized since they never depend on activeSection.
const HomeSection = memo(function HomeSection({ onLogin }: { onLogin: () => void }) {
    return (
        <>
            {/* Hero Section */}
            <section className="relative overflow-hidden px-6 py-12 lg:py-20 bg-white">
                <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="relative z-10 space-y-6">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 bg-zinc-50 rounded-full text-zinc-800 shadow-xs">
                            <span className="font-mono text-xs uppercase st font-bold">Autonomous Exploratory Testing</span>
                        </div>
                        <h1 className="text-[48px] lg:text-[64px] leading-tight text-black font-extrabold uppercase">
                            Uncover Every Bug.<br/><span className="text-zinc-400">Effortlessly.</span>
                        </h1>
                        <p className="text-[16px] leading-[24px] text-zinc-600 max-w-lg">
                            BugSafari autonomously explores your Single-Page App, scores every element with a self-learning model, and turns whatever breaks into a reproducible forensic report — no test scripts required.
                        </p>
                        <div className="flex flex-wrap gap-4 pt-4">
                            <button
                                onClick={onLogin}
                                className="px-8 py-3.5 bg-[#121212] text-white font-medium rounded-lg shadow-md hover:bg-zinc-800 transition-all flex items-center gap-2 cursor-pointer"
                            >
                                Start BugSafari
                            </button>
                        </div>
                    </div>

                    {/* Real Command Center screenshot in a browser-style frame */}
                    <div className="relative">
                        <div className="relative bg-white border border-zinc-200/80 rounded-xl overflow-hidden shadow-2xl shadow-zinc-200/50">
                            <div className="bg-zinc-50 px-4 py-2.5 flex items-center gap-2 border-b border-zinc-200/80">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                    <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                    <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                </div>
                                <div className="flex-1 text-center font-mono text-xs text-zinc-500 font-bold">BugSafari — Command Center</div>
                            </div>
                            <img
                                src="/marketing/dashboard-shell.png"
                                alt="The BugSafari Command Center dashboard"
                                className="w-full block"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Bento Grid (Fixed Icon Wrapping Issue with Solid Badges) */}
            <section className="py-24 px-6 bg-white">
                <div className="max-w-[1440px] mx-auto">
                    <div className="text-center mb-16 space-y-4">
                        <h2 className="text-[40px] text-black font-extrabold uppercase">Engineered for Technical Precision</h2>
                        <p className="text-[16px] text-zinc-600 max-w-2xl mx-auto">A clinical approach to SPA observability. No fluff, just the high-fidelity forensic evidence you need to fix what breaks faster.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {featureCards.map((card) => (
                            <div key={card.title} className="p-8 border border-zinc-200/80 rounded-xl bg-white shadow-md shadow-zinc-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group cursor-default flex flex-col justify-between">
                                <div>
                                    <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center font-mono font-bold text-[13px] mb-6 shrink-0">
                                        {card.tag}
                                    </div>
                                    <h3 className="text-[20px] mb-3 font-bold uppercase">{card.title}</h3>
                                    <p className="text-[13px] text-zinc-600 leading-relaxed">{card.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Deep Dive Section */}
            <section className="py-24 px-6 bg-zinc-50/50 relative overflow-hidden border-y border-zinc-200">
                <div className="max-w-[1440px] mx-auto relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                    <div className="space-y-6">
                        <h2 className="text-[40px] text-black font-extrabold uppercase">Deep Trace Analysis</h2>
                        <p className="text-[16px] text-zinc-600 leading-relaxed">Visualize how the engine moves through your app. The StateGraphNavigator renders every discovered page state and transition as a navigable forensic graph.</p>
                        <ul className="space-y-4">
                            {deepTraceChecks.map((item) => (
                                <li key={item.title} className="flex items-start gap-3">
                                    <span className="font-mono text-[13px] font-bold bg-[#121212] text-white w-5 h-5 rounded-full flex items-center justify-center mt-0.5">✓</span>
                                    <div>
                                        <h4 className="font-mono text-[13px] font-bold text-black uppercase">{item.title}</h4>
                                        <p className="text-[13px] text-zinc-600">{item.description}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="p-2 border border-zinc-200/80 rounded-2xl bg-white shadow-xl shadow-zinc-200/50">
                        <div className="w-full aspect-video rounded-xl overflow-hidden border border-zinc-200 shadow-inner">
                            <img
                                src="/marketing/dashboard-shell.png"
                                alt="BugSafari Command Center showing live exploration telemetry"
                                className="w-full h-full object-cover grayscale contrast-125 hover:grayscale-0 transition-all duration-500"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="py-32 px-6 text-center bg-white">
                <div className="max-w-3xl mx-auto space-y-8">
                    <h2 className="text-[48px] text-black font-extrabold uppercase">Ready to start your safari?</h2>
                    <p className="text-[16px] text-zinc-600">Point BugSafari at your Single-Page App and watch the state graph, risk scores, and live forensic telemetry build in real time.</p>
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <button
                            onClick={onLogin}
                            className="px-10 py-4 bg-[#121212] text-white font-medium rounded-lg shadow-md hover:bg-zinc-800 transition-all uppercase st text-xs cursor-pointer"
                        >
                            Try BugSafari
                        </button>
                    </div>
                    <div className="pt-8">
                        <p className="font-mono text-xs text-zinc-500 font-bold uppercase st">No signup required to try • Guest mode available</p>
                    </div>
                </div>
            </section>
        </>
    );
});

// Non-home sections share one header shape; content itself is reused from InfoPages so route pages stay in sync.
const InfoSection = memo(function InfoSection({ id }: { id: Exclude<SectionId, 'home'> }) {
    const meta = SECTION_META[id];
    return (
        <div className="pt-32 pb-24 px-6 max-w-[1440px] mx-auto">
            <div className="space-y-4 mb-16 border-b border-zinc-200 pb-8">
                <h1 className="text-[40px] lg:text-[56px] font-extrabold uppercase tracking-tight">{meta.title}</h1>
                <p className="text-[16px] text-zinc-600 max-w-2xl">{meta.subtitle}</p>
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
    const mainRef = useRef<HTMLElement>(null);
    const welcome = useWelcomeNotice();

    const goToSection = useCallback((id: SectionId) => {
        setActiveSection(id);
    }, []);

    // Smooth-scroll to the top of the content on every in-page section switch.
    useEffect(() => {
        mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [activeSection]);

    const goToLogin = useCallback(() => navigate('/login'), [navigate]);

    return (
        <div className="bg-white text-black min-h-screen font-sans selection:bg-[#121212] selection:text-white">
            <WelcomeModal isOpen={welcome.isOpen} onDismiss={welcome.dismiss} />
            <LegalDocModal docId={legalDoc} onClose={() => setLegalDoc(null)} />

            {/* Top Navigation Bar — stays mounted across every in-page section switch */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-zinc-200 shadow-sm">
                <div className="flex justify-between items-center w-full px-6 py-4 max-w-[1440px] mx-auto">
                    <div className="flex items-center gap-8">
                        <button onClick={() => goToSection('home')} className="text-[24px] font-extrabold text-black tracking-tighter uppercase text-left bg-transparent border-none cursor-pointer">
                            BUGSAFARI
                        </button>
                        <div className="hidden md:flex items-center gap-6">
                            {NAV_ITEMS.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => goToSection(item.id)}
                                    aria-current={activeSection === item.id ? 'page' : undefined}
                                    className={`font-mono text-sm font-medium transition-colors bg-transparent border-none cursor-pointer ${activeSection === item.id ? 'text-black border-b border-black pb-1' : 'text-zinc-500 hover:text-black'}`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={goToLogin}
                            className="px-5 py-2 font-mono text-[13px] font-semibold bg-[#121212] text-white rounded-lg shadow-sm hover:bg-zinc-800 transition-all focus:ring-2 focus:ring-black focus:outline-none cursor-pointer"
                        >
                            Log In
                        </button>

                        <button
                            onClick={() => navigate('/signup')}
                            className="px-5 py-2 font-mono text-[13px] font-semibold text-black border border-zinc-300 rounded-lg bg-transparent hover:bg-zinc-50 transition-all focus:ring-2 focus:ring-black focus:outline-none cursor-pointer"
                        >
                            Sign Up
                        </button>
                        
                    </div>
                </div>
            </nav>

            <main ref={mainRef} className="pt-16 scroll-mt-16">
                {activeSection === 'home' ? <HomeSection onLogin={goToLogin} /> : <InfoSection id={activeSection} />}
            </main>

            {/* Footer */}
            <footer className="bg-white border-t border-zinc-200">
                <div className="w-full px-6 py-12 max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div className="space-y-4">
                        <div className="text-[20px] font-extrabold text-black uppercase tracking-tighter">BugSafari</div>
                        <p className="text-[13px] text-zinc-500 font-medium max-w-xs">
                            © 2026 BugSafari. Autonomous exploratory testing for Single-Page Apps. Research prototype.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 md:gap-12">
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-xs font-extrabold text-black uppercase">Resources</span>
                            <button onClick={() => goToSection('explore')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Explore the Engine</button>
                            <button onClick={() => goToSection('features')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Features</button>
                            <button onClick={() => goToSection('community')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Community</button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-xs font-extrabold text-black uppercase">Legal</span>
                            <button onClick={() => setLegalDoc('privacy')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Privacy Notice</button>
                            <button onClick={() => setLegalDoc('terms')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Terms of Use</button>
                            <button onClick={() => setLegalDoc('research')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Research Disclaimer</button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-xs font-extrabold text-black uppercase">Project</span>
                            <button onClick={() => goToSection('about')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">About</button>
                            <button onClick={() => setLegalDoc('licenses')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Licenses</button>
                        </div>
                    </div>
                </div>
                <div className="max-w-[1440px] mx-auto px-6 py-6 border-t border-zinc-200 text-center md:text-left">
                    <p className="font-mono text-xs text-zinc-500 font-bold">AUTONOMOUS EXPLORATORY TESTING FOR SINGLE-PAGE APPS. AUTHORIZED TESTING ONLY.</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
