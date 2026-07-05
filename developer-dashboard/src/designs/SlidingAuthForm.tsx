import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm';
import SignupForm from '../components/auth/SignupForm';
import GradientBlinds from './GradientBlinds';
import { useTheme, PALETTES, type ColorPalette } from './ThemeContext';
import { useAuth } from '../context/AuthContext';

// Generate gradient colors based on theme palette
function getOverlayGradientColors(palette: ColorPalette): string[] {
    const colors = PALETTES[palette];
    return [colors.primary, colors.secondary, colors.tertiary, colors.quaternary];
}

export default function SlidingAuthForm() {
    const [isSignup, setIsSignup] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const navigate = useNavigate();
    const { theme, colorPalette } = useTheme();
    const overlayRef = useRef<HTMLDivElement>(null);
    
    // Use auth context for guest access - handled internally now
    const { login } = useAuth();

    const handleBack = () => {
        navigate('/');
    };

    // Guest access handled via context directly in LoginForm
    const handleGuestAccess = () => {
        // Set guest mode in localStorage and navigate
        localStorage.setItem('bugsafari_guest', 'true');
        navigate('/dashboard');
    };

    const handleToggle = () => {
        if (isAnimating) return;
        setIsAnimating(true);
        setIsSignup(!isSignup);
        setTimeout(() => setIsAnimating(false), 500);
    };

    const overlayGradientColors = getOverlayGradientColors(colorPalette);

    // Determine which panel is active for content
    const activePanel = isSignup ? 'signup' : 'login';

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            {/* Background gradient blinds - pointer-events-none ensures it doesn't block clicks */}
            <div className="absolute inset-0 pointer-events-none">
                <GradientBlinds gradientColors={["#0F172A", "#1E293B", "#2563EB", "#334155"]} />
            </div>

            {/* Main sliding container - Slightly smaller sizing applied here */}
            <div className="relative w-[75vw] h-[80vh] max-w-5xl min-w-[800px] min-h-[600px] mx-auto z-10">
                {/* Back button positioned inside the card, above login form */}
                <button
                    onClick={handleBack}
                    className="absolute -top-12 left-0 z-30 flex items-center gap-1 px-3 py-2 rounded-lg bg-white/90 hover:bg-white shadow-md hover:shadow-lg transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
                    aria-label="Back to homepage"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back
                </button>

                <div className="relative bg-white/95 shadow-2xl rounded-xl overflow-hidden flex h-full w-full">

{/* Left Panel: Login Form */}
                    <div
                        className={`absolute inset-y-0 left-0 w-1/2 p-8 h-full flex flex-col justify-center overflow-auto transition-all duration-500 ease-in-out ${activePanel === 'login'
                            ? 'opacity-100 translate-x-0 z-10'
                            : 'opacity-0 -translate-x-[20%] z-0 pointer-events-none'
                            }`}
                    >
                        <div className="w-full max-w-md mx-auto">
                            <LoginForm onGuestAccess={handleGuestAccess} />
                        </div>
                    </div>

                    {/* Right Panel: Signup Form */}
                    <div
                        className={`absolute inset-y-0 right-0 w-1/2 p-8 h-full flex flex-col justify-center overflow-auto transition-all duration-500 ease-in-out ${activePanel === 'signup'
                            ? 'opacity-100 translate-x-0 z-10'
                            : 'opacity-0 translate-x-[20%] z-0 pointer-events-none'
                            }`}
                    >
                        <div className="w-full max-w-md mx-auto">
                            <SignupForm />
                        </div>
                    </div>

                    {/* Sliding Overlay Panel with GradientBlinds */}
                    <div
                        ref={overlayRef}
                        // Fixed logic: when isSignup is false (login active), overlay covers the right (translate-x-full).
                        // When isSignup is true (signup active), overlay covers the left (translate-x-0).
                        className={`absolute inset-y-0 left-0 w-1/2 h-full transition-transform duration-500 ease-in-out z-20 shadow-2xl ${isSignup ? 'translate-x-0' : 'translate-x-full'
                            }`}
                    >
                        {/* The GradientBlinds Animation specific to the sliding overlay */}
                        <div className="absolute inset-0">
                            <GradientBlinds
                                gradientColors={overlayGradientColors}
                                angle={45}
                                noise={0.2}
                                blindCount={12}
                                mouseDampening={0.1}
                                spotlightRadius={0.3}
                                spotlightOpacity={0.6}
                            />
                        </div>

                        <div className="relative w-full h-full flex flex-col items-center justify-center p-8 text-white">
                            {/* Gradient overlay for better text readability */}
                            <div className="absolute inset-0 bg-black/20" />

                            <div className="relative text-center max-w-md">
                                <h2 className="text-3xl sm:text-4xl font-bold mb-4 drop-shadow-md">
                                    {isSignup ? 'Welcome Back!' : 'Hello, Friend!'}
                                </h2>
                                <p className="mb-8 text-base sm:text-lg opacity-90 drop-shadow-sm leading-relaxed">
                                    {isSignup
                                        ? 'To keep connected with us please login with your personal info'
                                        : 'Enter your personal details and start your journey with us'
                                    }
                                </p>
                                <button
                                    className="h-12 px-6 bg-white font-bold rounded-md shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                                    onClick={handleToggle}
                                    disabled={isAnimating}
                                    style={{
                                        color: theme.primary,
                                    }}
                                >
                                    {isSignup ? 'Sign In' : 'Create Account'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}