import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radar, Brain, ClipboardCheck, Link2, Play, Eye, FileText } from 'lucide-react';
import { ExploreContent, FeaturesContent, CommunityContent, AboutContent } from '../pages/InfoPages';
import { SECTION_META } from '../pages/sectionMeta';
import WelcomeModal from '../components/common/WelcomeModal';
import { LegalDocModal } from '../components/legal/LegalDocModal';
import type { LegalDocId } from '../legal/content';
import { useWelcomeNotice } from '../hooks/useWelcomeNotice';

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
            'It learns which parts of your app are most likely to break, such as logins, payments, and deletes, and spends its time where real bugs hide.',
    },
    {
        icon: ClipboardCheck,
        title: 'Shows What Broke',
        description:
            'Every bug comes with clear, step-by-step instructions to reproduce it, so you know exactly what to fix.',
    },
];

const howItWorks = [
    { icon: Link2, title: 'Add Your App', description: 'Paste the web address of the app you want to test.' },
    { icon: Play, title: 'Press Start', description: 'Click once and BugSafari starts exploring. Pause or resume anytime.' },
    { icon: Eye, title: 'Watch It Explore', description: 'See every click, form, and result stream in live.' },
    { icon: FileText, title: 'Get Your Report', description: 'Review each bug it found, with steps to reproduce and fix it.' },
];

const trustStats = [
    { value: '16', label: 'Types of bugs caught' },
    { value: '5', label: 'Ways to test your app' },
    { value: '0', label: 'Test scripts to write' },
    { value: 'Free', label: 'To try, no signup' },
];

const testimonials = [
    { quote: 'It found a broken checkout flow the night before my demo. Saved me.', name: 'Student Developer', role: 'Capstone Project' },
    { quote: 'I got a full bug report without writing a single test. That never happens.', name: 'Indie Builder', role: 'Side Project' },
    { quote: 'The reproduce steps meant I actually knew what to fix, not just that something broke.', name: 'Junior Engineer', role: 'First SaaS' },
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

// Static marketing sections, memoized since they never depend on activeSection.
const HomeSection = memo(function HomeSection({ onLogin }: { onLogin: () => void }) {
    return (
        <>
            {/* Hero Section */}
            <section className="relative overflow-hidden px-6 py-10 bg-nova-light">
                <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                    <div className="relative z-10 min-w-0 space-y-5">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 bg-zinc-50 rounded-full text-zinc-800 shadow-xs">
                            <span className="font-mono text-xs uppercase st font-bold">Automated App Testing</span>
                        </div>
                        <h1 className="text-[clamp(2rem,5vw,4rem)] leading-[1.1] text-black font-extrabold uppercase break-words [text-wrap:balance]">
                            Find Bugs <span className="text-zinc-400">Before Your Users Do.</span>
                        </h1>
                        <p className="text-[16px] leading-[24px] text-zinc-600 max-w-lg">
                            BugSafari explores your web app on its own, clicking, typing, and stress-testing it like a real user. It then gives you a clear report of everything that broke and how to reproduce it. No test scripts required.
                        </p>
                        <div className="flex flex-wrap gap-4 pt-2">
                            <button
                                onClick={onLogin}
                                className="px-8 py-3.5 bg-[#121212] text-white font-medium rounded-lg shadow-md hover:bg-zinc-800 transition-all flex items-center gap-2 cursor-pointer"
                            >
                                Try It Free
                            </button>
                        </div>
                        <p className="font-mono text-xs text-zinc-500 font-bold uppercase st pt-2">No signup needed to try • Free guest mode</p>
                    </div>

                    {/* Product screenshot in a browser-style frame */}
                    <div className="relative min-w-0">
                        <div className="relative bg-white border border-zinc-200/80 rounded-xl overflow-hidden shadow-2xl shadow-zinc-200/50">
                            <div className="bg-zinc-50 px-4 py-2.5 flex items-center gap-2 border-b border-zinc-200/80">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                    <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                    <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                </div>
                                <div className="flex-1 text-center font-mono text-xs text-zinc-500 font-bold">BugSafari: Live Dashboard</div>
                            </div>
                            <img
                                src="/marketing/dashboard-shell.png"
                                alt="The BugSafari dashboard showing a live test in progress"
                                className="w-full block"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Trust indicators */}
            <section className="px-6 pb-8 bg-nova-light">
                <div className="max-w-[1440px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-200 border border-zinc-200 rounded-xl overflow-hidden">
                    {trustStats.map((stat) => (
                        <div key={stat.label} className="bg-white p-6 text-center space-y-1">
                            <div className="text-3xl font-extrabold tracking-tight">{stat.value}</div>
                            <div className="text-xs font-mono uppercase text-zinc-500">{stat.label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Feature Highlights */}
            <section className="py-16 px-6 bg-nova-light">
                <div className="max-w-[1440px] mx-auto">
                    <div className="text-center mb-12 space-y-3">
                        <h2 className="text-[40px] text-black font-extrabold uppercase">Testing That Runs Itself</h2>
                        <p className="text-[16px] text-zinc-600 max-w-2xl mx-auto">Catch the bugs your users would find, without writing a single test. BugSafari does the exploring so you can focus on building.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {featureCards.map((card) => (
                            <div key={card.title} className="p-6 border border-zinc-200/80 rounded-xl bg-white shadow-md shadow-zinc-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group cursor-default flex flex-col justify-between">
                                <div>
                                    <div className="w-12 h-12 bg-[#121212] text-white rounded-lg flex items-center justify-center mb-4 shrink-0">
                                        <card.icon className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" />
                                    </div>
                                    <h3 className="text-[20px] mb-3 font-bold uppercase">{card.title}</h3>
                                    <p className="text-[13px] text-zinc-600 leading-relaxed">{card.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="py-16 px-6 bg-zinc-50/50 border-y border-zinc-200">
                <div className="max-w-[1440px] mx-auto space-y-10">
                    <div className="text-center space-y-3">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase st">How It Works</span>
                        <h2 className="text-[40px] text-black font-extrabold uppercase">From App To Bug Report In Four Steps</h2>
                        <p className="text-[16px] text-zinc-600 max-w-2xl mx-auto">No setup and no scripts. Get real results in minutes.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {howItWorks.map((item) => (
                            <div key={item.title} className="p-6 bg-white border border-zinc-200 rounded-xl space-y-3 shadow-xs">
                                <div className="w-10 h-10 bg-[#121212] text-white rounded-lg flex items-center justify-center">
                                    <item.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
                                </div>
                                <h4 className="text-lg font-bold uppercase">{item.title}</h4>
                                <p className="text-[13px] text-zinc-600 leading-relaxed">{item.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Watch it live */}
            <section className="py-16 px-6 bg-nova-light">
                <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div className="space-y-5">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase st">See It In Action</span>
                        <h2 className="text-[40px] text-black font-extrabold uppercase">Watch Every Step, Live</h2>
                        <p className="text-[16px] text-zinc-600 leading-relaxed">Follow along as BugSafari explores your app in real time. See what it clicks, what it types, and the moment something breaks, all on one clear dashboard.</p>
                        <ul className="space-y-4">
                            <li className="flex items-start gap-3">
                                <span className="font-mono text-[13px] font-bold bg-[#121212] text-white w-5 h-5 rounded-full flex items-center justify-center mt-0.5">✓</span>
                                <p className="text-[13px] text-zinc-600">Every action and result streams in as it happens, nothing hidden.</p>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="font-mono text-[13px] font-bold bg-[#121212] text-white w-5 h-5 rounded-full flex items-center justify-center mt-0.5">✓</span>
                                <p className="text-[13px] text-zinc-600">It keeps finding new ground instead of getting stuck in circles.</p>
                            </li>
                        </ul>
                    </div>
                    <div className="p-2 border border-zinc-200/80 rounded-2xl bg-white shadow-xl shadow-zinc-200/50">
                        <div className="w-full aspect-video rounded-xl overflow-hidden border border-zinc-200 shadow-inner">
                            <img
                                src="/marketing/dashboard-shell.png"
                                alt="The BugSafari dashboard streaming a test in real time"
                                className="w-full h-full object-cover grayscale contrast-125 hover:grayscale-0 transition-all duration-500"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Testimonials */}
            <section className="py-16 px-6 bg-zinc-50/50 border-y border-zinc-200">
                <div className="max-w-[1440px] mx-auto space-y-10">
                    <div className="text-center space-y-3">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase st">Loved By Builders</span>
                        <h2 className="text-[40px] text-black font-extrabold uppercase">Bugs Caught. Demos Saved.</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {testimonials.map((t) => (
                            <div key={t.quote} className="p-6 bg-white border border-zinc-200 rounded-xl shadow-sm flex flex-col justify-between space-y-5">
                                <p className="text-[15px] text-zinc-700 leading-relaxed">“{t.quote}”</p>
                                <div>
                                    <div className="font-bold text-[13px] uppercase">{t.name}</div>
                                    <div className="font-mono text-xs text-zinc-400">{t.role}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQ */}
            <section className="py-16 px-6 bg-nova-light">
                <div className="max-w-3xl mx-auto space-y-8">
                    <div className="text-center space-y-3">
                        <h2 className="text-[40px] text-black font-extrabold uppercase">Common Questions</h2>
                    </div>
                    <div className="border border-zinc-200 rounded-2xl divide-y divide-zinc-200 bg-white overflow-hidden">
                        {homeFaqs.map((it) => (
                            <details key={it.q} className="group p-6">
                                <summary className="cursor-pointer list-none flex justify-between items-center gap-4 font-bold text-base">
                                    {it.q}
                                    <span className="shrink-0 w-6 h-6 rounded-full border border-zinc-300 flex items-center justify-center text-[13px] group-open:rotate-45 transition-transform">+</span>
                                </summary>
                                <p className="pt-3 text-[13px] text-zinc-600 leading-relaxed">{it.a}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="py-20 px-6 text-center bg-zinc-50/50 border-t border-zinc-200">
                <div className="max-w-3xl mx-auto space-y-6">
                    <h2 className="text-[48px] text-black font-extrabold uppercase">Ready To Catch More Bugs?</h2>
                    <p className="text-[16px] text-zinc-600">Point BugSafari at your app and watch it work. It is free to try, with no signup, no scripts, and no setup.</p>
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <button
                            onClick={onLogin}
                            className="px-10 py-4 bg-[#121212] text-white font-medium rounded-lg shadow-md hover:bg-zinc-800 transition-all uppercase st text-xs cursor-pointer"
                        >
                            Start Testing Free
                        </button>
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
        <div className="pt-6 pb-6 px-6 max-w-[1440px] mx-auto">
            <div className="space-y-3 mb-10 border-b border-zinc-200 pb-6">
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
        <div className="bg-nova-light text-black min-h-screen font-sans selection:bg-[#121212] selection:text-white">
            <WelcomeModal isOpen={welcome.isOpen} onDismiss={welcome.dismiss} />
            <LegalDocModal docId={legalDoc} onClose={() => setLegalDoc(null)} />

            {/* Top Navigation Bar, stays mounted across every in-page section switch */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-nova-light/95 backdrop-blur-md border-b border-zinc-200 shadow-sm">
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
            <footer className="bg-nova-light border-t border-zinc-200">
                <div className="w-full px-6 py-10 max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div className="space-y-4">
                        <div className="text-[20px] font-extrabold text-black uppercase tracking-tighter">BugSafari</div>
                        <p className="text-[13px] text-zinc-500 font-medium max-w-xs">
                            © 2026 BugSafari. Automated bug-hunting for your web app. Built for students and independent developers.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 md:gap-12">
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-xs font-extrabold text-black uppercase">Product</span>
                            <button onClick={() => goToSection('explore')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">How It Works</button>
                            <button onClick={() => goToSection('features')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Features</button>
                            <button onClick={() => goToSection('community')} className="font-mono text-xs text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Who It's For</button>
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
                    <p className="font-mono text-xs text-zinc-500 font-bold">ONLY TEST APPS YOU OWN OR HAVE PERMISSION TO TEST.</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
