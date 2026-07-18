import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

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

const CheckIcon = () => (
  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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
      <div className="min-h-screen bg-[var(--surface-app)] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-[var(--surface-panel)] p-6 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] border border-[var(--border-hairline)] text-center">
            <div className="w-16 h-16 bg-[var(--status-stable-bg)] border border-[var(--status-stable-border)] rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-[var(--status-stable-fg)]"><CheckIcon /></span>
            </div>
            <p className="text-xs font-mono font-medium tracking-[0.14em] text-[var(--text-tertiary)] mb-2">RECOVERY DISPATCHED</p>
            <h2 className="text-h4 font-semibold text-[var(--text-primary)] mb-2">Check your inbox</h2>
            <p className="text-[var(--text-secondary)] mb-6">
              If an account exists with that email, a password reset link has been sent.
            </p>
            <p className="text-sm text-[var(--text-tertiary)] mb-6">
              In development, check the server console for the reset link.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
            >
              <ArrowLeftIcon />
              <span className="ml-2">Back to sign in</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--surface-app)] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[var(--surface-panel)] p-6 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] border border-[var(--border-hairline)]">
          <p className="text-center text-xs font-mono font-medium tracking-[0.14em] text-[var(--text-tertiary)] mb-2">PASSWORD RECOVERY</p>
          <h2 className="text-h4 font-semibold text-[var(--text-primary)] text-center mb-2">Forgot password?</h2>
          <p className="text-base text-[var(--text-secondary)] text-center mb-6">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-[var(--text-tertiary)] pointer-events-none">
                <MailIcon />
              </span>
              <Input
                id="email"
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                placeholder="you@example.com"
                required
              />
            </div>

            {/* Submit Button */}
            <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading}>
              {isLoading ? 'Sending...' : 'Send Reset Link'}
            </Button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 flex justify-center">
            <Link
              to="/login"
              className="inline-flex items-center text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
            >
              <ArrowLeftIcon />
              <span className="ml-2">Back to sign in</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
