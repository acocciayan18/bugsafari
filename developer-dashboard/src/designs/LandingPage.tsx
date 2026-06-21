import { useNavigate } from 'react-router-dom';
import { useTheme, type ColorPalette } from './ThemeContext';
import MagicBento from './components/MagicBento';
import CircularGallery from './components/CircularGallery';
import FlowingMenu from './components/FlowingMenu';
import ChromaGrid from './components/ChromaGrid';
import './globals.css';

// Feature cards for the "Why Us" section
const whyUsCards = [
    {
        icon: 'S',
        title: 'Scriptless Traversal',
        description: 'Automated SPA exploration using advanced DOM parsing and heuristic path discovery. No manual test scripts required.',
    },
    {
        icon: 'A',
        title: 'Adaptive Intelligence',
        description: 'ML-powered risk scoring prioritizes high-risk UI states and edge cases automatically.',
    },
    {
        icon: 'F',
        title: 'Real-time Forensics',
        description: 'Live telemetry streaming provides instant bug detection with detailed reproduction steps.',
    },
    {
        icon: 'C',
        title: 'Continuous Learning',
        description: 'The engine learns from each run, improving bug detection accuracy over time.',
    },
];

// Footer links
const footerColumns = [
    {
        title: 'Product',
        links: ['Features', 'Pricing', 'Documentation', 'API'],
    },
    {
        title: 'Company',
        links: ['About', 'Blog', 'Careers', 'Contact'],
    },
    {
        title: 'Legal',
        links: ['Privacy', 'Terms', 'Security', 'Cookies'],
    },
    {
        title: 'Social',
        links: ['GitHub', 'Twitter', 'Discord', 'LinkedIn'],
    },
];

const LandingPage = () => {
    const navigate = useNavigate();
    const { colorPalette, setColorPalette, theme, themeRGB } = useTheme();

    const handlePaletteChange = (palette: ColorPalette) => {
        setColorPalette(palette);
    };

    return (
        <div className="min-h-screen" style={{ background: 'var(--color-background)' }}>
            {/* ============================================
       * SECTION 1: NAVIGATION BAR
       * ============================================ */}
            <nav className="navbar">
                <div className="navbar__brand">BUGSAFARI</div>

                <div className="navbar__nav">
                    <a href="#features" className="navbar__link">Features</a>
                    <a href="#why-us" className="navbar__link">Why Us</a>
                    <a href="#showcase" className="navbar__link">Showcase</a>
                    <a href="#community" className="navbar__link">Community</a>
                </div>

                <div className="navbar__actions">
                    <button
                        onClick={() => navigate('/login')}
                        className="navbar__link"
                    >
                        Sign in
                    </button>
                    <button
                        className="btn btn--primary"
                        onClick={() => {
                            // Set guest mode and navigate to dashboard
                            localStorage.setItem('bugsafari_guest', 'true');
                            navigate('/dashboard');
                        }}
                        style={{ background: theme.primary }}
                    >
                        Get Started
                    </button>
                </div>
            </nav>

            {/* ============================================
       * SECTION 2: HERO SECTION
       * ============================================ */}
            <section className="hero">
                <div className="hero__background" />

                <h1 className="hero__title">
                    Autonomous Testing<br />
                    <span style={{ color: theme.primary }}>For Modern SPAs</span>
                </h1>

                <p className="hero__subtitle">
                    BugSafari is an independent digital investigator that helps student developers
                    bridge the "predictability gap" by autonomously finding unhandled exceptions,
                    race conditions, and hidden bugs without requiring any manual test scripts.
                </p>

                <div className="hero__cta">
                    <button
                        className="btn btn--primary"
                        onClick={() => navigate('/login')}
                        style={{ background: theme.primary }}
                    >
                        Start Free Trial
                    </button>
                    <button
                        className="btn btn--secondary"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}
                    >
                        Watch Demo
                    </button>
                </div>
            </section>

            {/* ============================================
       * SECTION 3: FEATURES - MagicBento
       * ============================================ */}
            <section id="features" className="features">
                <MagicBento glowColor={themeRGB.primary} enableStars={true} enableSpotlight={true} />
            </section>

            {/* ============================================
       * SECTION 4: WHY US
       * ============================================ */}
            <section id="why-us" className="features">
                <div className="features__grid">
                    {whyUsCards.map((card, index) => (
                        <div key={index} className="feature-card">
                            <div
                                className="feature-card__icon"
                                style={{ background: theme.secondary }}
                            >
                                <span style={{ fontSize: '1.5rem', color: theme.primary }}>{card.icon}</span>
                            </div>
                            <h3 className="feature-card__title">{card.title}</h3>
                            <p className="feature-card__description">{card.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ============================================
       * SECTION 5: VISUAL SHOWCASE - CircularGallery
       * ============================================ */}
            <section id="showcase" className="showcase">
                <h2 style={{
                    textAlign: 'center',
                    fontSize: '2.5rem',
                    fontWeight: 800,
                    marginBottom: '2rem',
                    color: 'var(--color-text-primary)'
                }}>
                    Visual Showcase
                </h2>
                <div style={{ height: '600px', display: 'flex', justifyContent: 'center' }}>
                    <CircularGallery textColor={theme.primary} />
                </div>
            </section>

            {/* ============================================
       * SECTION 6: NAVIGATION LINKS - FlowingMenu
       * ============================================ */}
            <section>
                <FlowingMenu
                    bgColor="var(--color-surface)"
                    marqueeBgColor={theme.primary}
                    textColor="var(--color-text-primary)"
                />
            </section>

            {/* ============================================
       * SECTION 7: COMMUNITY/TEAM CTA - ChromaGrid
       * ============================================ */}
            <section id="community" className="cta-section">
                <div className="cta-section__grid">
                    <div className="cta-section__content">
                        <h2 className="cta-section__title">
                            Join the <span style={{ color: theme.primary }}>Community</span>
                        </h2>
                        <p className="cta-section__description">
                            Connect with thousands of developers who are already using BugSafari to build better applications.
                            Share your experiences, get help, and contribute to the open-source project.
                        </p>
                        <div className="hero__cta">
                            <button
                                className="btn btn--primary"
                                style={{ background: theme.primary }}
                            >
                                Join Discord
                            </button>
                            <button
                                className="btn btn--secondary"
                                style={{ borderColor: theme.primary, color: theme.primary }}
                            >
                                Star on GitHub
                            </button>
                        </div>
                    </div>

                    <ChromaGrid
                        borderColor={theme.primary}
                        gradient={`linear-gradient(135deg, ${theme.primary} 0%, ${theme.secondary} 100%)`}
                    />
                </div>
            </section>

            {/* ============================================
       * SECTION 8: FOOTER
       * ============================================ */}
            <footer className="footer">
                <div className="footer__grid">
                    {footerColumns.map((column, index) => (
                        <div key={index} className="footer__column">
                            <h4 className="footer__title">{column.title}</h4>
                            {column.links.map((link, linkIndex) => (
                                <a key={linkIndex} href="#" className="footer__link">{link}</a>
                            ))}
                        </div>
                    ))}
                </div>
                <div className="footer__bottom">
                    <p>© 2024 BugSafari Engine. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
