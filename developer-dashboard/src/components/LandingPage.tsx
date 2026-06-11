// ─────────────────────────────────────────────────────────────
// LandingPage.tsx - Main Landing Page Layout
// ─────────────────────────────────────────────────────────────
// Contains entire layout with Navigation, Hero, Features, Diagnostic Overlay, Footer
// Uses routing for login instead of modal

import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

const LandingPage: FC = () => {
    const [scanUrl, setScanUrl] = useState('');
    const navigate = useNavigate();

    const handleScan = (e: React.FormEvent) => {
        e.preventDefault();
        alert(`Scanning: ${scanUrl}`);
    };

    return (
        <div className="min-h-screen bg-white">
            {/* NAVIGATION BAR */}
            <nav className="flex items-center justify-between px-8 py-4 border-b-2 border-black">
                <div className="text-2xl font-bold tracking-tight">BUGSAFARI</div>
                <div className="flex items-center gap-8">
                    <a href="#" className="text-sm font-medium hover:underline">Product</a>
                    <a href="#" className="text-sm font-medium hover:underline">Solutions</a>
                    <a href="#" className="text-sm font-medium hover:underline">Pricing</a>
                    <a href="#" className="text-sm font-medium hover:underline">Docs</a>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/login')}
                        className="text-sm font-bold uppercase tracking-wide hover:text-gray-600"
                    >
                        LOGIN
                    </button>
                    <button className="px-4 py-2 text-sm font-bold text-white bg-black border-2 border-black hover:bg-gray-800">
                        TRY BUGSAFARI
                    </button>
                </div>
            </nav>

            {/* HERO SECTION */}
            <section className="flex flex-col lg:flex-row min-h-[80vh]">
                <div className="flex-1 flex flex-col justify-center px-8 lg:px-16 py-16">
                    <h1 className="text-5xl lg:text-6xl font-bold leading-tight mb-4">
                        What is BugSafari?
                    </h1>
                    <p className="text-xl font-semibold mb-6 text-gray-700">
                        An Autonomous, Adaptive Exploratory Testing Engine for Single-Page Applications.
                    </p>
                    <p className="text-base text-gray-600 mb-8 max-w-xl leading-relaxed">
                        BugSafari acts as an independent digital investigator. It helps student developers
                        bridge the "predictability gap" by autonomously finding unhandled exceptions,
                        race conditions, and hidden bugs without requiring any manual test scripts.
                    </p>
                    <form onSubmit={handleScan} className="flex max-w-lg">
                        <input
                            type="url"
                            value={scanUrl}
                            onChange={(e) => setScanUrl(e.target.value)}
                            placeholder="https://your-spa-url.com"
                            className="flex-1 px-4 py-3 border-2 border-black focus:outline-none focus:ring-2 focus:ring-black placeholder:text-gray-400"
                        />
                        <button
                            type="submit"
                            className="px-8 py-3 text-sm font-bold text-white bg-black border-2 border-black hover:bg-gray-800"
                        >
                            SCAN
                        </button>
                    </form>
                </div>

                <div className="flex-1 p-8 lg:p-16">
                    <div className="h-full border-2 border-black bg-gray-50 p-6 relative" style={{ backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
                        <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-4 py-2 border-b-2 border-black bg-black">
                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        </div>
                        <pre className="font-mono text-sm mt-8 text-gray-800">
                            {`> WARNING: DEPRECATED API USAGE DETECTED
> Line 47: React.ComponentWillMount
>
> GENERATING HEURISTIC MAP...
> [████████░░] 73% COMPLETE
>
> EXPLORING STATE SPACE:
>  - LoginForm.tsx
>  - Dashboard.tsx
>  - AuthMiddleware.ts
>
> DISCOVERED PATTERNS:
>  ⚠ UNHANDLED PROMISE REJECTION
>  ⚠ RACE CONDITION IN USER FETCH
>
> SCAN COMPLETE: 12 ANOMALIES FOUND`}
                        </pre>
                    </div>
                </div>
            </section>

            {/* FEATURES SECTION */}
            <section className="py-16 px-8 border-t-2 border-black">
                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="flex-1 border-2 border-black p-6">
                        <div className="w-12 h-12 mb-4 border-2 border-black flex items-center justify-center">
                            <span className="text-2xl font-bold">◇</span>
                        </div>
                        <h3 className="text-xl font-bold mb-3">Scriptless Traversal</h3>
                        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                            Automated SPA exploration using advanced DOM parsing and heuristic path discovery.
                            No manual test scripts required - BugSafari discovers bugs autonomously.
                        </p>
                        <div className="pt-4 border-t-2 border-black">
                            <span className="text-xs font-bold tracking-wider">AUTONOMOUS</span>
                        </div>
                    </div>

                    <div className="flex-1 border-2 border-black p-6">
                        <div className="w-12 h-12 mb-4 border-2 border-black flex items-center justify-center">
                            <span className="text-2xl font-bold">◆</span>
                        </div>
                        <h3 className="text-xl font-bold mb-3">Adaptive Intelligence</h3>
                        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                            ML-powered risk scoring prioritizes high-risk UI states and edge cases automatically.
                            Learns from your application&apos;s behavior to focus on critical paths.
                        </p>
                        <div className="pt-4 border-t-2 border-black">
                            <span className="text-xs font-bold tracking-wider">TARGETED</span>
                        </div>
                    </div>

                    <div className="flex-1 border-2 border-black p-6">
                        <div className="w-12 h-12 mb-4 border-2 border-black flex items-center justify-center">
                            <span className="text-2xl font-bold">○</span>
                        </div>
                        <h3 className="text-xl font-bold mb-3">Real-time Forensics</h3>
                        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                            Live telemetry streaming provides instant bug detection with detailed reproduction steps.
                            Comprehensive reports with stack traces and state snapshots.
                        </p>
                        <div className="pt-4 border-t-2 border-black">
                            <span className="text-xs font-bold tracking-wider">STREAMING</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* DIAGNOSTIC OVERLAY SECTION */}
            <section className="py-16 px-8">
                <div className="border-2 border-black">
                    <div className="flex items-center justify-between px-4 py-2 border-b-2 border-black bg-black">
                        <span className="font-mono text-sm text-white">TERMINAL_MODE: DIAGNOSTIC_OVERLAY</span>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row">
                        <div className="flex-1 p-6 border-b-2 lg:border-b-0 lg:border-r-2 border-black">
                            <h3 className="text-xl font-bold mb-3">Deep Trace Analysis</h3>
                            <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                                Every bug found includes a full replayable sequence with DOM snapshots and network logs.
                            </p>
                            <div className="border-2 border-black p-4 font-mono text-xs bg-gray-50">
                                <div className="text-gray-400">// code-trace.js</div>
                                <div><span className="text-purple-600">const</span> trace = {'{'}</div>
                                <div className="pl-4">state: captured,</div>
                                <div className="pl-4">actions: ['click', 'input'],</div>
                                <div className="pl-4">timestamp: 1234567890</div>
                                <div>{'}'}</div>
                            </div>
                        </div>

                        <div className="flex-1 p-6 border-b-2 lg:border-b-0 lg:border-r-2 border-black flex flex-col items-center justify-center">
                            <span className="text-8xl lg:text-9xl font-black">94%</span>
                            <span className="text-sm font-bold tracking-wider mt-2">DISCOVERY RATE</span>
                        </div>

                        <div className="flex-1 p-6 flex flex-col items-center justify-center">
                            <div className="w-16 h-16 mb-4 border-2 border-black flex items-center justify-center">
                                <span className="text-4xl">🛡</span>
                            </div>
                            <span className="text-sm font-bold text-center">Zero-Config Deployment</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* FOOTER */}
            <footer className="flex flex-col lg:flex-row items-center justify-between px-8 py-6 border-t-2 border-black">
                <div className="text-lg font-bold">BugSafari</div>
                <div className="flex items-center gap-6 my-4 lg:my-0">
                    <a href="#" className="text-sm hover:underline">STATUS</a>
                    <a href="#" className="text-sm hover:underline">PRIVACY</a>
                    <a href="#" className="text-sm hover:underline">TERMS</a>
                    <a href="#" className="text-sm hover:underline">SECURITY</a>
                    <a href="#" className="text-sm hover:underline">GITHUB</a>
                </div>
                <div className="text-sm text-gray-600">© 2024 BUGSAFARI ENGINE. ALL RIGHTS RESERVED.</div>
            </footer>
        </div>
    );
};

export default LandingPage;