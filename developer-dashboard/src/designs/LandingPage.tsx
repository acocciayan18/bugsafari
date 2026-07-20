import { useNavigate } from 'react-router-dom';
import './globals.css';

const featureCards = [
    {
        icon: '⟳',
        title: 'Scriptless Traversal',
        description:
            'Navigate complex application states without writing brittle scripts. BugSafari maps and explores interaction paths automatically.',
    },
    {
        icon: '✦',
        title: 'Adaptive Intelligence',
        description:
            'Signal-driven prioritization continuously focuses on volatile surfaces so critical defects are surfaced first.',
    },
    {
        icon: '▣',
        title: 'Real-Time Forensics',
        description:
            'Capture telemetry, console anomalies, and reproducible traces as sessions unfold to accelerate diagnosis.',
    },
];

const deepTraceChecks = [
    'Session-scoped anomaly tracing',
    'Correlated console + network timelines',
    'Visual state diffing for rapid verification',
    'Auto-generated reproduction context',
];

const LandingPage = () => {
    const navigate = useNavigate();

    return (
        <div className="lp-page">
            <header className="lp-header">
                <div className="lp-container lp-header__inner">
                    <a href="#" className="lp-logo" aria-label="BugSafari home">
                        BugSafari
                    </a>

                    <nav className="lp-nav" aria-label="Primary">
                        <a href="#" className="lp-nav__link lp-nav__link--active">Product</a>
                        <a href="#" className="lp-nav__link">Solutions</a>
                        <a href="#" className="lp-nav__link">Pricing</a>
                        <a href="#" className="lp-nav__link">Docs</a>
                    </nav>

                    <div className="lp-utilities" aria-label="Utilities">
                        <button className="lp-icon-btn lp-icon-btn--plain" aria-label="Notifications">
                            <svg viewBox="0 0 24 24" className="lp-icon-svg" aria-hidden="true">
                                <path
                                    d="M9 18h6M10.5 21h3M6 17h12c-1.2-1.1-2-2.7-2-4.4V10a4 4 0 1 0-8 0v2.6C8 14.3 7.2 15.9 6 17Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </button>
                        <button className="lp-icon-btn lp-icon-btn--plain" aria-label="Help">
                            <svg viewBox="0 0 24 24" className="lp-icon-svg" aria-hidden="true">
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="9"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                />
                                <path
                                    d="M9.8 9.1a2.5 2.5 0 0 1 4.4 1.6c0 1.7-1.8 2.1-2.2 3.3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                />
                                <circle cx="12" cy="16.8" r="1" fill="currentColor" />
                            </svg>
                        </button>
                    </div>
                </div>
            </header>

            <main>
                <section className="lp-section lp-hero">
                    <div className="lp-container lp-hero__grid">
                        <div className="lp-hero__content">
                            <span className="lp-pill">New: Omnichannel Integration</span>
                            <h1 className="lp-hero__title">Ignite Your Ideas with BugSafari</h1>
                            <p className="lp-hero__desc">
                                Build with confidence using autonomous exploration, forensic telemetry,
                                and adaptive guidance designed to keep delivery momentum high.
                            </p>

                            <div className="lp-actions">
                                <button className="lp-btn lp-btn--primary" onClick={() => navigate('/login')}>
                                    Try BugSafari
                                </button>
                                <button className="lp-btn lp-btn--ghost">Watch Demo</button>
                            </div>

                            <div className="lp-proof">
                                <div className="lp-proof__avatars" aria-hidden="true">
                                    <span className="lp-avatar" />
                                    <span className="lp-avatar" />
                                    <span className="lp-avatar" />
                                </div>
                                <p className="lp-proof__text">Trusted by 2,500+ product teams worldwide.</p>
                            </div>
                        </div>

                        <div className="lp-hero__visual" aria-label="Dashboard preview">
                            <div className="lp-dashboard">
                                <div className="lp-dashboard__top">
                                    <span />
                                    <span />
                                    <span />
                                </div>
                                <div className="lp-dashboard__body">
                                    <div className="lp-panel lp-panel--lg" />
                                    <div className="lp-panel-group">
                                        <div className="lp-panel" />
                                        <div className="lp-panel" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="lp-section lp-features">
                    <div className="lp-container">
                        <header className="lp-section-head">
                            <h2>Engineered for Momentum</h2>
                        </header>

                        <div className="lp-feature-grid">
                            {featureCards.map((card) => (
                                <article key={card.title} className="lp-feature-card">
                                    <div className="lp-feature-card__icon">{card.icon}</div>
                                    <h3>{card.title}</h3>
                                    <p>{card.description}</p>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="lp-section">
                    <div className="lp-container">
                        <div className="lp-deep-dive">
                            <div className="lp-deep-dive__content">
                                <h2>Deep Trace Analysis</h2>
                                <p>
                                    Visualize failures with context-rich diagnostics that map root causes
                                    across event streams, runtime signals, and interaction transitions.
                                </p>
                                <ul className="lp-checklist">
                                    {deepTraceChecks.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                                <button className="lp-btn lp-btn--primary">Explore the Visualizer</button>
                            </div>

                            <div className="lp-deep-dive__visual" aria-label="Deep trace dashboard">
                                <div className="lp-node-canvas">
                                    <div className="lp-node lp-node--center" />
                                    <div className="lp-node lp-node--a" />
                                    <div className="lp-node lp-node--b" />
                                    <div className="lp-node lp-node--c" />
                                    <div className="lp-node lp-node--d" />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="lp-section lp-cta">
                    <div className="lp-container lp-cta__inner">
                        <h2>Ready to start your safari?</h2>
                        <div className="lp-actions">
                            <button className="lp-btn lp-btn--primary">Start Free Trial</button>
                            <button className="lp-btn lp-btn--ghost">Schedule Demo</button>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="lp-footer">
                <div className="lp-container lp-footer__inner">
                    <p> 2024 BugSafari. All rights reserved.</p>
                    <nav className="lp-footer__links" aria-label="Legal">
                        <a href="#">Privacy Policy</a>
                        <a href="#">Terms of Service</a>
                        <a href="#">Contact Support</a>
                    </nav>
                    <div className="lp-footer__locale">English (US)</div>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;