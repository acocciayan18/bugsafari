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
            <nav className="flex items-center justify-between px-8 py-4 border-b border-gray-200 shadow-sm bg-white/80 backdrop-blur-sm">
                <div className="text-2xl font-bold tracking-tight text-slate-800">BUGSAFARI</div>
                <div className="flex items-center gap-8">
                    <a href="#" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Product</a>
                    <a href="#" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Solutions</a>
                    <a href="#" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Pricing</a>
                    <a href="#" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">Docs</a>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/login')}
                        className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                    >
                        Sign in
                    </button>
                    <button className="px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors shadow-md">
                        Try BugSafari
                    </button>
                </div>
            </nav>

{/* HERO SECTION */}
            <section className="flex flex-col lg:flex-row min-h-[80vh]">
                <div className="flex-1 flex flex-col justify-center px-8 lg:px-16 py-16">
                    <h1 className="text-5xl lg:text-6xl font-bold leading-tight mb-4 text-slate-900">
                        What is BugSafari?
                    </h1>
                    <p className="text-xl font-medium mb-6 text-slate-700">
                        An Autonomous, Adaptive Exploratory Testing Engine for Single-Page Applications.
                    </p>
                    <p className="text-base text-slate-600 mb-8 max-w-xl leading-relaxed">
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
                            className="flex-1 px-4 py-3 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent placeholder:text-slate-400 shadow-sm"
                        />
                        <button
                            type="submit"
                            className="px-8 py-3 text-sm font-medium text-white bg-slate-900 rounded-r-lg hover:bg-slate-800 transition-colors shadow-md"
                        >
                            Scan
                        </button>
                    </form>
                </div>

                <div className="flex-1 p-8 lg:p-16">
                    <div className="h-full bg-gradient-to-br from-slate-50 to-white rounded-2xl p-8 shadow-lg border border-gray-100">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-3 h-3 rounded-full bg-red-400"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                            <div className="w-3 h-3 rounded-full bg-green-400"></div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                <span className="text-sm text-slate-600">Autonomous exploration</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                <span className="text-sm text-slate-600">ML-powered bug detection</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                <span className="text-sm text-slate-600">Real-time forensics</span>
                            </div>
                            <div className="mt-6 pt-4 border-t border-gray-100">
                                <p className="text-sm font-medium text-slate-500">Try it now - no setup required</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

{/* FEATURES SECTION */}
            <section className="py-16 px-8 border-t border-gray-100">
                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="flex-1 rounded-xl p-6 shadow-md border border-gray-100 hover:shadow-lg transition-shadow">
                        <div className="w-12 h-12 mb-4 rounded-lg bg-slate-100 flex items-center justify-center">
                            <span className="text-2xl text-slate-700">◇</span>
                        </div>
                        <h3 className="text-xl font-semibold mb-3 text-slate-900">Scriptless Traversal</h3>
                        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                            Automated SPA exploration using advanced DOM parsing and heuristic path discovery.
                            No manual test scripts required - BugSafari discovers bugs autonomously.
                        </p>
                        <div className="pt-4 border-t border-gray-100">
                            <span className="text-xs font-medium text-slate-500 tracking-wider">AUTONOMOUS</span>
                        </div>
                    </div>

                    <div className="flex-1 rounded-xl p-6 shadow-md border border-gray-100 hover:shadow-lg transition-shadow">
                        <div className="w-12 h-12 mb-4 rounded-lg bg-slate-100 flex items-center justify-center">
                            <span className="text-2xl text-slate-700">◆</span>
                        </div>
                        <h3 className="text-xl font-semibold mb-3 text-slate-900">Adaptive Intelligence</h3>
                        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                            ML-powered risk scoring prioritizes high-risk UI states and edge cases automatically.
                            Learns from your application&apos;s behavior to focus on critical paths.
                        </p>
                        <div className="pt-4 border-t border-gray-100">
                            <span className="text-xs font-medium text-slate-500 tracking-wider">TARGETED</span>
                        </div>
                    </div>

                    <div className="flex-1 rounded-xl p-6 shadow-md border border-gray-100 hover:shadow-lg transition-shadow">
                        <div className="w-12 h-12 mb-4 rounded-lg bg-slate-100 flex items-center justify-center">
                            <span className="text-2xl text-slate-700">○</span>
                        </div>
                        <h3 className="text-xl font-semibold mb-3 text-slate-900">Real-time Forensics</h3>
                        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                            Live telemetry streaming provides instant bug detection with detailed reproduction steps.
                            Comprehensive reports with stack traces and state snapshots.
                        </p>
                        <div className="pt-4 border-t border-gray-100">
                            <span className="text-xs font-medium text-slate-500 tracking-wider">STREAMING</span>
                        </div>
                    </div>
                </div>
            </section>

{/* DIAGNOSTIC OVERLAY SECTION */}
            <section className="py-16 px-8">
                <div className="rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-slate-900">
                        <span className="font-mono text-sm text-slate-300">Diagnostic Overview</span>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-400"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                            <div className="w-3 h-3 rounded-full bg-green-400"></div>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row">
                        <div className="flex-1 p-6 border-b lg:border-b-0 lg:border-r border-gray-100">
                            <h3 className="text-xl font-semibold mb-3 text-slate-900">Deep Trace Analysis</h3>
                            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                                Every bug found includes a full replayable sequence with DOM snapshots and network logs.
                            </p>
                            <div className="border border-gray-200 rounded-lg p-4 font-mono text-xs bg-slate-50">
                                <div className="text-slate-400">// code-trace.js</div>
                                <div><span className="text-purple-600">const</span> trace = {'{'}</div>
                                <div className="pl-4">state: captured,</div>
                                <div className="pl-4">actions: ['click', 'input'],</div>
                                <div className="pl-4">timestamp: 1234567890</div>
                                <div>{'}'}</div>
                            </div>
                        </div>

                        <div className="flex-1 p-6 border-b lg:border-b-0 lg:border-r border-gray-100 flex flex-col items-center justify-center">
                            <span className="text-8xl lg:text-9xl font-bold text-slate-900">94%</span>
                            <span className="text-sm font-medium text-slate-500 tracking-wider mt-2">Discovery Rate</span>
                        </div>

                        <div className="flex-1 p-6 flex flex-col items-center justify-center">
                            <div className="w-16 h-16 mb-4 rounded-xl bg-slate-100 flex items-center justify-center">
                                <span className="text-4xl">🛡</span>
                            </div>
                            <span className="text-sm font-medium text-center text-slate-700">Zero-Config Deployment</span>
                        </div>
                    </div>
                </div>
            </section>

{/* FOOTER */}
            <footer className="flex flex-col lg:flex-row items-center justify-between px-8 py-6 border-t border-gray-100">
                <div className="text-lg font-semibold text-slate-800">BugSafari</div>
                <div className="flex items-center gap-6 my-4 lg:my-0">
                    <a href="#" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Status</a>
                    <a href="#" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Privacy</a>
                    <a href="#" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Terms</a>
                    <a href="#" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Security</a>
                    <a href="#" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">GitHub</a>
                </div>
                <div className="text-sm text-slate-500">© 2024 BugSafari Engine. All rights reserved.</div>
            </footer>
        </div>
    );
};

export default LandingPage;