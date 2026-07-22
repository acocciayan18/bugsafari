import { useNavigate } from 'react-router-dom';

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

export function ExplorePage() {
    return (
        <PageShell title="Explore System Observability" subtitle="Discover how BugSafari performs advanced forensic-level analysis on complex distributed systems.">
            <div className="space-y-16">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold shrink-0">01</div>
                        <h3 className="text-xl font-bold uppercase">Automated Topology Mapping</h3>
                        <p className="text-zinc-600 text-sm leading-relaxed">Let our adaptive AI parse dependencies and map out your microservice architecture dynamically without writing custom manual tracking code.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-zinc-50/50 space-y-4 shadow-xs">
                        <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold shrink-0">02</div>
                        <h3 className="text-xl font-bold uppercase">Live State Replay</h3>
                        <p className="text-zinc-600 text-sm leading-relaxed">Rewind and inspect packet payloads and state transitions with nanosecond accuracy during active production incidents.</p>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}

export function FeaturesPage() {
    return (
        <PageShell title="Core Features & Architecture" subtitle="Engineered for clinical precision, high-fidelity production telemetry, and absolute system reliability.">
            <div className="space-y-16">
                {/* Main 3 Feature Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold mb-6 shrink-0">AI</div>
                            <h3 className="text-xl font-bold uppercase mb-2">Scriptless Traversal</h3>
                            <p className="text-sm text-zinc-600 leading-relaxed">Navigate through complex microservices and state machines automatically without writing a single manual test script or framework boilerplate.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Zero Configuration</div>
                    </div>

                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold mb-6 shrink-0">ML</div>
                            <h3 className="text-xl font-bold uppercase mb-2">Adaptive Intelligence</h3>
                            <p className="text-sm text-zinc-600 leading-relaxed">The forensic engine continually learns your system's baseline behavior patterns to flag anomalous performance drops instantly.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Self-Learning Core</div>
                    </div>

                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4 flex flex-col justify-between">
                        <div>
                            <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold mb-6 shrink-0">RT</div>
                            <h3 className="text-xl font-bold uppercase mb-2">Real-Time Forensics</h3>
                            <p className="text-sm text-zinc-600 leading-relaxed">Rewind and replay live runtime states with nanosecond precision to inspect exact logic branches as they happened in production.</p>
                        </div>
                        <div className="pt-4 border-t border-zinc-100 font-mono text-xs text-zinc-400 font-bold uppercase">Nanosecond Precision</div>
                    </div>
                </div>

                {/* Extended Technical Capabilities */}
                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-zinc-50/50 space-y-8">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Advanced Platform Capabilities</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">01</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Cross-Node Logic Isolation</h4>
                                <p className="text-sm text-zinc-600">Isolate execution traces across 1,000+ separate nodes to identify cascading network failures in seconds.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">02</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Automated Dependency Mapping</h4>
                                <p className="text-sm text-zinc-600">Detect hidden circular dependencies and recursive API loops automatically without manual diagramming.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">03</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Instant Incident Reports</h4>
                                <p className="text-sm text-zinc-600">Export clean, structured diagnostic dossiers containing full stack traces and confidence scores for engineering teams.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start bg-white p-6 rounded-xl border border-zinc-200 shadow-xs">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shrink-0 font-mono text-xs font-bold">04</div>
                            <div className="space-y-1">
                                <h4 className="font-bold text-lg">Zero-Overhead Agents</h4>
                                <p className="text-sm text-zinc-600">Lightweight monitoring architecture designed to consume minimal memory and CPU resources on live production boxes.</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Additional Feature Breakdown: Security & Scalability */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="p-6 border border-zinc-200 rounded-xl bg-white space-y-3 shadow-xs">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">Security</span>
                        <h4 className="font-bold text-lg">Strict Boundary Enforcements</h4>
                        <p className="text-sm text-zinc-600">Lock down test execution environments within predefined network scopes to protect sensitive production databases and user privacy.</p>
                    </div>
                    <div className="p-6 border border-zinc-200 rounded-xl bg-white space-y-3 shadow-xs">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">Reliability</span>
                        <h4 className="font-bold text-lg">Anomaly Early Warnings</h4>
                        <p className="text-sm text-zinc-600">Receive predictive health metrics that flag potential memory leaks or runtime exceptions before they impact end-users.</p>
                    </div>
                    <div className="p-6 border border-zinc-200 rounded-xl bg-white space-y-3 shadow-xs">
                        <span className="font-mono text-xs font-bold text-zinc-400 uppercase tracking-widest">Performance</span>
                        <h4 className="font-bold text-lg">Sub-Millisecond Telemetry</h4>
                        <p className="text-sm text-zinc-600">High-throughput trace ingestion pipelines built specifically for extreme enterprise application traffic demands.</p>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}

export function CommunityPage() {
    return (
        <PageShell title="Community & Ecosystem" subtitle="Collaborate, share trace configurations, and build the future of automated runtime verification together.">
            <div className="space-y-16">
                {/* Community Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4">
                        <div className="w-10 h-10 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold text-sm">01</div>
                        <h3 className="text-xl font-bold uppercase">Global Engineering Network</h3>
                        <p className="text-zinc-600 text-sm leading-relaxed">Connect with thousands of developers and SRE leads across the globe. Share custom diagnostic patterns, discuss optimization strategies, and solve complex production bottlenecks together.</p>
                    </div>
                    <div className="p-8 border border-zinc-200 rounded-xl bg-white shadow-sm space-y-4">
                        <div className="w-10 h-10 bg-black text-white rounded-lg flex items-center justify-center font-mono font-bold text-sm">02</div>
                        <h3 className="text-xl font-bold uppercase">Open Source Contribution</h3>
                        <p className="text-zinc-600 text-sm leading-relaxed">Contribute directly to our core debugging SDKs, custom visualization renderers, and parser plugins. Our open-source repositories thrive on community-driven improvements.</p>
                    </div>
                </div>

                {/* Upcoming Events */}
                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-zinc-50/50 space-y-6">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Upcoming Community Events & Workshops</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <span className="font-mono text-xs font-bold text-zinc-400 uppercase">Virtual Meetup</span>
                            <h4 className="font-bold text-lg">Async Debugging Mastery</h4>
                            <p className="text-xs text-zinc-600">Deep dive into handling subtle race conditions in high-concurrency microservices.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <span className="font-mono text-xs font-bold text-zinc-400 uppercase">Workshop</span>
                            <h4 className="font-bold text-lg">Custom Trace Engines</h4>
                            <p className="text-xs text-zinc-600">Learn how to configure specialized rulesets for custom enterprise system architectures.</p>
                        </div>
                        <div className="p-6 bg-white border border-zinc-200 rounded-xl space-y-2 shadow-xs">
                            <span className="font-mono text-xs font-bold text-zinc-400 uppercase">Hackathon</span>
                            <h4 className="font-bold text-lg">BugSafari Plugin Fest</h4>
                            <p className="text-xs text-zinc-600">Build and publish your own custom dashboard integrations for developer community rewards.</p>
                        </div>
                    </div>
                </div>

                {/* Discussion Channels */}
                <div className="p-8 border border-zinc-200 rounded-xl bg-white space-y-6">
                    <h3 className="text-xl font-bold uppercase">Where to Connect</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-100">
                            <h4 className="font-bold mb-1">GitHub Discussions</h4>
                            <p className="text-sm text-zinc-600">For feature requests, roadmap tracking, and technical Q&A.</p>
                        </div>
                        <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-100">
                            <h4 className="font-bold mb-1">Discord Server</h4>
                            <p className="text-sm text-zinc-600">Real-time chats with core maintainers and fellow engineering peers.</p>
                        </div>
                        <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-100">
                            <h4 className="font-bold mb-1">Developer Blog</h4>
                            <p className="text-sm text-zinc-600">Deep-dive technical articles, release notes, and case studies.</p>
                        </div>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}

export function AboutPage() {
    return (
        <PageShell title="About BugSafari" subtitle="Our mission is to eliminate production guesswork through automated runtime forensics and deep observability.">
            <div className="space-y-16 max-w-4xl">
                {/* Story Section */}
                <div className="space-y-6 text-zinc-700 leading-relaxed text-base">
                    <p>BugSafari was born out of a simple frustration: modern microservice architectures have become too complex for traditional logging and manual test scripts to keep up with. When critical production incidents happen at 2:00 AM, engineers shouldn't have to spend hours digging blindly through raw logs.</p>
                    <p>We built an intelligent autonomous testing and diagnostic engine that delivers clinical precision—allowing teams to trace logic paths, isolate anomalies, and resolve bottlenecks in seconds rather than hours.</p>
                </div>

                {/* Core Values */}
                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-white shadow-sm space-y-8">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Our Core Principles</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-sm tracking-wide">01. Uncompromising Clarity</h4>
                            <p className="text-sm text-zinc-600">No ambiguous alerts or bloated metrics. Every data point provided is actionable, direct, and focused on root-cause resolution.</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-sm tracking-wide">02. Engineering First</h4>
                            <p className="text-sm text-zinc-600">Built by engineers, for engineers. We prioritize high performance, minimal server overhead, and absolute system reliability.</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-sm tracking-wide">03. Continuous Evolution</h4>
                            <p className="text-sm text-zinc-600">Systems change fast, and our adaptive intelligence evolves alongside them, learning new behavioral baselines automatically.</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-bold text-lg text-black uppercase font-mono text-sm tracking-wide">04. Data Privacy</h4>
                            <p className="text-sm text-zinc-600">Strict boundary guardrails ensure your production runtime packets remain secure and contained within authorized environments.</p>
                        </div>
                    </div>
                </div>

                {/* Leadership & Engineering Team Overview */}
                <div className="border border-zinc-200 rounded-2xl p-8 lg:p-12 bg-zinc-50/50 space-y-6">
                    <h2 className="text-2xl font-extrabold uppercase tracking-tight">Built for Modern Systems</h2>
                    <p className="text-sm text-zinc-600 leading-relaxed">
                        Headquartered at the intersection of developer tooling and automated AI verification, BugSafari brings together distributed systems experts, frontend architects, and backend security researchers dedicated to changing how software is debugged worldwide.
                    </p>
                </div>
            </div>
        </PageShell>
    );
}