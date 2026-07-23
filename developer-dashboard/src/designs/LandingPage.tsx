import { useNavigate } from 'react-router-dom';

const featureCards = [
    {
        tag: 'AI',
        title: 'Scriptless Traversal',
        description:
            'Clicks through your pages, forms, and buttons on its own. No test scripts to write or maintain.',
    },
    {
        tag: 'ML',
        title: 'Adaptive Intelligence',
        description:
            'A scoring model learns which elements are worth testing and adjusts its choices as it explores.',
    },
    {
        tag: 'RT',
        title: 'Real-time Forensics',
        description:
            'Keeps the last 20 actions before a crash, so you can see exactly what led to it.',
    },
];

const deepTraceChecks = [
    {
        title: 'State Tracking',
        description: 'Tracks each page state it visits during a run.',
    },
    {
        title: 'Loop Detection',
        description: 'Recognizes when it has already tried something and moves on.',
    },
];

const LandingPage = () => {
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
                            <button onClick={() => navigate('/explore')} className="font-mono text-[13px] font-semibold text-zinc-500 hover:text-black transition-colors bg-transparent border-none cursor-pointer">Explore</button>
                            <button onClick={() => navigate('/features')} className="font-mono text-[13px] font-semibold text-zinc-500 hover:text-black transition-colors bg-transparent border-none cursor-pointer">Features</button>
                            <button onClick={() => navigate('/community')} className="font-mono text-[13px] font-semibold text-zinc-500 hover:text-black transition-colors bg-transparent border-none cursor-pointer">Community</button>
                            <button onClick={() => navigate('/about')} className="font-mono text-[13px] font-semibold text-zinc-500 hover:text-black transition-colors bg-transparent border-none cursor-pointer">About</button>
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

            <main className="pt-16">
                {/* Hero Section */}
                <section className="relative overflow-hidden px-6 py-12 lg:py-20 bg-white">
                    <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                        <div className="relative z-10 space-y-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 bg-zinc-50 rounded-full text-zinc-800 shadow-xs">
                                <span className="font-mono text-[11px] uppercase tracking-widest font-bold">Automated Web Testing</span>
                            </div>
                            <h1 className="text-[48px] lg:text-[64px] leading-tight text-black font-extrabold uppercase">
                                Find Bugs.<br/><span className="text-zinc-400">Automatically.</span>
                            </h1>
                            <p className="text-[16px] leading-[24px] text-zinc-600 max-w-lg">
                                BugSafari explores your web app the way a real user would — clicking through pages, filling in forms, and testing inputs on its own. It finds crashes and errors without you writing a single test script.
                            </p>
                            <div className="flex flex-wrap gap-4 pt-4">
                                <button 
                                    onClick={() => navigate('/login')}
                                    className="px-8 py-3.5 bg-black text-white font-medium rounded-lg shadow-md hover:bg-zinc-800 transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    Start BugSafari
                                </button>
                                <button className="px-8 py-3.5 border border-zinc-200 rounded-lg text-black font-medium bg-white shadow-xs hover:bg-zinc-50 transition-all cursor-pointer">
                                    Book a Demo
                                </button>
                            </div>
                        </div>

                        {/* Dashboard Mockup Visualization */}
                        <div className="relative">
                            <div className="relative bg-white border border-zinc-200/80 rounded-xl overflow-hidden shadow-2xl shadow-zinc-200/50">
                                <div className="bg-zinc-50 px-4 py-2.5 flex items-center gap-2 border-b border-zinc-200/80">
                                    <div className="flex gap-1.5">
                                        <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                        <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                        <div className="w-3 h-3 rounded-full border border-zinc-300 bg-zinc-200"></div>
                                    </div>
                                    <div className="flex-1 text-center font-mono text-[11px] text-zinc-500 font-bold">bugsafari-session.log</div>
                                </div>
                                <div className="p-4 space-y-4 font-mono text-[13px] bg-white text-zinc-800">
                                    <div className="flex gap-4">
                                        <div className="w-12 text-zinc-400 text-right select-none">124</div>
                                        <div className="text-black"><span className="font-bold text-indigo-600">async</span> function <span className="underline decoration-zinc-300">handleClick</span>(element) &#123;</div>
                                    </div>
                                    <div className="flex gap-4 bg-zinc-50 border-l-2 border-zinc-400 py-1.5 px-2 rounded-r items-center shadow-xs">
                                        <div className="w-10 text-zinc-600 font-bold text-right select-none">125</div>
                                        <div className="text-zinc-800">&nbsp; let result = <span className="font-bold text-indigo-600">await</span> engine.testElement(element);</div>
                                        <div className="ml-auto flex items-center gap-1 px-2 py-0.5 bg-black text-white text-[10px] font-bold rounded">
                                            CRASH
                                        </div>
                                    </div>
                                    <div className="flex gap-4">
                                        <div className="w-12 text-zinc-400 text-right select-none">126</div>
                                        <div className="text-zinc-400">&nbsp; // Unhandled promise rejection detected</div>
                                    </div>
                                    <div className="pt-4 border-t border-zinc-200/80 mt-4">
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="p-3.5 space-y-2 border border-zinc-200/80 rounded-lg bg-zinc-50/50 shadow-xs">
                                                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Elements Scanned</div>
                                                <div className="text-[18px] font-bold">842</div>
                                                <div className="h-1.5 w-full bg-zinc-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-black rounded-full w-4/5"></div>
                                                </div>
                                            </div>
                                            <div className="p-3.5 space-y-2 border border-zinc-200/80 rounded-lg bg-zinc-50/50 shadow-xs">
                                                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">States Explored</div>
                                                <div className="text-[18px] font-bold">63</div>
                                                <div className="h-1.5 w-full bg-zinc-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-black rounded-full w-1/3"></div>
                                                </div>
                                            </div>
                                            <div className="p-3.5 space-y-2 border border-zinc-200/80 rounded-lg bg-zinc-50/50 shadow-xs">
                                                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Risk Score</div>
                                                <div className="text-[18px] font-bold">87</div>
                                                <div className="h-1.5 w-full bg-zinc-200 rounded-full overflow-hidden">
                                                    <div className="h-full bg-black rounded-full w-11/12"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Features Bento Grid (Fixed Icon Wrapping Issue with Solid Badges) */}
                <section className="py-24 px-6 bg-white">
                    <div className="max-w-[1440px] mx-auto">
                        <div className="text-center mb-16 space-y-4">
                            <h2 className="text-[40px] text-black font-extrabold uppercase">What It Does</h2>
                            <p className="text-[16px] text-zinc-600 max-w-2xl mx-auto">A straightforward testing tool. It shows you what broke and gives you the steps to reproduce it.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {featureCards.map((card) => (
                                <div key={card.title} className="p-8 border border-zinc-200/80 rounded-xl bg-white shadow-md shadow-zinc-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group cursor-default flex flex-col justify-between">
                                    <div>
                                        <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold text-sm mb-6 shrink-0">
                                            {card.tag}
                                        </div>
                                        <h3 className="text-[20px] mb-3 font-bold uppercase">{card.title}</h3>
                                        <p className="text-[14px] text-zinc-600 leading-relaxed">{card.description}</p>
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
                            <h2 className="text-[40px] text-black font-extrabold uppercase">See What It Found</h2>
                            <p className="text-[16px] text-zinc-600 leading-relaxed">Every run keeps a record of the pages and actions it tried, so you can follow the exact steps that led to a bug.</p>
                            <ul className="space-y-4">
                                {deepTraceChecks.map((item) => (
                                    <li key={item.title} className="flex items-start gap-3">
                                        <span className="font-mono text-sm font-bold bg-black text-white w-5 h-5 rounded-full flex items-center justify-center mt-0.5">✓</span>
                                        <div>
                                            <h4 className="font-mono text-[13px] font-bold text-black uppercase">{item.title}</h4>
                                            <p className="text-sm text-zinc-600">{item.description}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="p-2 border border-zinc-200/80 rounded-2xl bg-white shadow-xl shadow-zinc-200/50">
                            <div className="w-full aspect-video rounded-xl overflow-hidden border border-zinc-200 shadow-inner">
                                <img 
                                    src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80" 
                                    alt="Trace Graph Topology" 
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
                        <p className="text-[16px] text-zinc-600">Point BugSafari at your app's URL and see what it finds.</p>
                        <div className="flex flex-col sm:flex-row justify-center gap-4">
                            <button
                                onClick={() => navigate('/login')}
                                className="px-10 py-4 bg-black text-white font-medium rounded-lg shadow-md hover:bg-zinc-800 transition-all uppercase tracking-widest text-xs cursor-pointer"
                            >
                                Try BugSafari
                            </button>
                            <button className="px-10 py-4 border border-zinc-200 rounded-lg text-black font-medium bg-white shadow-xs hover:bg-zinc-50 transition-all uppercase tracking-widest text-xs cursor-pointer">
                                Schedule Demo
                            </button>
                        </div>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="bg-white border-t border-zinc-200">
                <div className="w-full px-6 py-12 max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div className="space-y-4">
                        <div className="text-[20px] font-extrabold text-black uppercase tracking-tighter">BugSafari</div>
                        <p className="text-[14px] text-zinc-500 font-medium max-w-xs">
                            © 2026 BugSafari. Automated testing for web apps.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 md:gap-12">
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-[11px] font-extrabold text-black uppercase">Resources</span>
                            <button onClick={() => navigate('/explore')} className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Documentation</button>
                            <button onClick={() => navigate('/features')} className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">API Reference</button>
                            <button onClick={() => navigate('/community')} className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Changelog</button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-[11px] font-extrabold text-black uppercase">Legal</span>
                            <a className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors" href="#">Privacy Policy</a>
                            <a className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors" href="#">Terms of Service</a>
                            <a className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors" href="#">Security</a>
                        </div>
                        <div className="flex flex-col gap-3">
                            <span className="font-mono text-[11px] font-extrabold text-black uppercase">Company</span>
                            <button onClick={() => navigate('/about')} className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">About Us</button>
                            <a className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors" href="#">Careers</a>
                            <button onClick={() => navigate('/community')} className="font-mono text-[11px] text-zinc-500 hover:text-black transition-colors text-left bg-transparent border-none cursor-pointer p-0">Blog</button>
                        </div>
                    </div>
                </div>
                <div className="max-w-[1440px] mx-auto px-6 py-6 border-t border-zinc-200 text-center md:text-left">
                    <p className="font-mono text-[11px] text-zinc-500 font-bold">BUILT FOR TESTING WEB APPS.</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;