import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

// Icons
const MailIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

interface ForgotPasswordResponse {
  ok?: boolean;
  message?: string;
  error?: string;
}

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data: ForgotPasswordResponse = await response.json();

      if (response.ok && data.ok) {
        setEmailSent(true);
        toast.success('Password reset link sent! Check server console for the reset link.');
      } else {
        const errorMessage = data.error ?? 'Failed to send reset link';
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      toast.error(errorMessage);
      console.error('[ForgotPassword] Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Show success message after email is sent
  if (emailSent) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-slate-100 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-100 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Check Your Inbox</h2>
            <p className="text-slate-500 mb-6">
              If an account exists with that email, a password reset link has been sent.
            </p>
            <p className="text-sm text-slate-400 mb-6">
              In development, check the server console for the reset link.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center text-sm text-slate-600 hover:text-slate-800 transition-colors"
            >
              <ArrowLeftIcon />
              <span className="ml-2">Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-100">
          <h2 className="text-xl font-bold tracking-tight text-slate-800 text-center mb-2">Forgot Password?</h2>
          <p className="text-base text-slate-500 text-center mb-6">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
          
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                  <MailIcon />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 pl-10 text-sm text-slate-800 placeholder-slate-300 focus:bg-white focus:border-slate-400 focus:outline-none transition-colors"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-md"
            >
              {isLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 flex justify-center">
            <Link
              to="/login"
              className="inline-flex items-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ArrowLeftIcon />
              <span className="ml-2">Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
