import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import GradientBlinds from '../designs/GradientBlinds';

interface SignupFormProps {
  onSignupSuccess?: (newToken: string, newUser: { id: string; email: string }) => void;
}

// Icons
const UserIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const EnvelopeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v11.25a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75" />
  </svg>
);

const LockClosedIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const EyeSlashIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export default function SignupForm({ onSignupSuccess }: SignupFormProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigate = useNavigate();

  // Password validation
  const hasMinLength = password.length >= 12;
  const hasSymbol = /[_!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasNoSequential = !/(.)\1{2,}|abc|123|qwe|password|pass/i.test(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!fullName.trim()) {
      setFormError('Please enter your full name.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setFormError('Please enter a valid email address.');
      return;
    }

    if (!password || password.length < 12) {
      setFormError('Password must be at least 12 characters.');
      return;
    }

    if (!hasSymbol || !hasNumber) {
      setFormError('Password must include symbols and numbers.');
      return;
    }

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

      // Make real API call to backend for user registration
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 409) {
          setFormError('An account with this email already exists.');
        } else {
          setFormError(data.error || 'Account creation failed. Please try again.');
        }
        setIsLoading(false);
        return;
      }

      // Success - backend returns token and user
      if (data.token && data.user) {
        // Show success toast and redirect to login
        toast.success("Account created successfully! Please log in.");

        // Navigate to login page after successful signup
        navigate('/login');
      } else {
        setFormError('Unexpected response from server.');
      }

    } catch (err) {
      console.error('[SignupForm] Signup error:', err);
      setFormError('Unable to connect to server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestLogin = () => {
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-4">
      {/* GradientBlinds Background */}
      <div className="absolute inset-0 z-0">
        <GradientBlinds
          gradientColors={['#1e293b', '#334155', '#475569', '#64748b']}
          angle={25}
          noise={0.15}
          blindCount={12}
          mouseDampening={0.12}
          mirrorGradient={true}
          spotlightRadius={0.6}
          spotlightSoftness={1.2}
          spotlightOpacity={0.8}
          distortAmount={0.3}
        />
      </div>
      <div className="w-full max-w-md z-10">

        {/* Header */}
        <div className="text-center mb-8">
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-100">
          <h2 className="text-xl font-bold tracking-tight text-slate-800 text-center mb-2">BugSafari</h2>
          <p className="text-base text-slate-500 text-center mb-6">Create your account</p>
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* FULL NAME */}
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-2">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                  <UserIcon />
                </div>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 pl-10 text-sm text-slate-800 placeholder-slate-300 focus:bg-white focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="Linus Torvalds"
                  required
                />
              </div>
            </div>

            {/* WORK EMAIL */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                Work Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                  <EnvelopeIcon />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 pl-10 text-sm text-slate-800 placeholder-slate-300 focus:bg-white focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="developer@bugsafari.io"
                  required
                />
              </div>
            </div>

            {/* PASSWORD */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                  <LockClosedIcon />
                </div>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 pl-10 pr-10 text-sm text-slate-800 placeholder-slate-300 focus:bg-white focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="••••••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* CONFIRM PASSWORD */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                  <LockClosedIcon />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 pl-10 pr-10 text-sm text-slate-800 placeholder-slate-300 focus:bg-white focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="••••••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showConfirmPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* PASSWORD REQUIREMENTS */}
            <div className="pt-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Password Requirements
              </p>
              <div className="space-y-1">
                <div className={`flex items-center gap-2 text-xs ${hasMinLength ? 'text-green-600' : 'text-red-500'}`}>
                  <span className={hasMinLength ? 'text-green-600' : 'text-red-500'}>
                    {hasMinLength ? <CheckIcon /> : <XIcon />}
                  </span>
                  <span>Minimum 12 characters</span>
                </div>
                <div className={`flex items-center gap-2 text-xs ${hasSymbol && hasNumber ? 'text-green-600' : 'text-slate-400'}`}>
                  <span className={hasSymbol && hasNumber ? 'text-green-600' : 'text-slate-400'}>
                    <CheckIcon />
                  </span>
                  <span>Include symbols &amp; numbers</span>
                </div>
                <div className={`flex items-center gap-2 text-xs ${hasNoSequential ? 'text-green-600' : 'text-slate-400'}`}>
                  <span className={hasNoSequential ? 'text-green-600' : 'text-slate-400'}>
                    <CheckIcon />
                  </span>
                  <span>No sequential strings</span>
                </div>
              </div>
            </div>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{formError}</p>
              </div>
            )}

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={isLoading || !fullName || !email || !password || !confirmPassword}
              className="w-full rounded-lg bg-slate-800 px-4 py-3 mt-2 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:bg-slate-700 transition-colors shadow-md"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Creating account...</span>
                </>
              ) : (
                'Create Account →'
              )}
            </button>
          </form>

          {/* LINKS */}
          <div className="mt-6 flex flex-col items-center space-y-4">
            <Link
              to="/login"
              className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-4 transition-colors"
            >
              Already have an account? Log in
            </Link>
            <button
              type="button"
              onClick={handleGuestLogin}
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              Continue As Guest Mode
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
