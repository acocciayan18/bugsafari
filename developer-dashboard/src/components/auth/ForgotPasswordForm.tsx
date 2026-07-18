import { useState, useRef, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Mail, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import AuthShell from './AuthShell';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

interface ForgotPasswordResponse {
  ok?: boolean;
  message?: string;
  error?: string;
}

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [serverError, setServerError] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const emailFormatValid = email.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailFieldError = (touched || submitted) && email.trim().length === 0
    ? 'Email is required.'
    : (touched || submitted) && !emailFormatValid
    ? 'Enter a valid email address, like name@company.com.'
    : '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setServerError('');

    if (!emailFormatValid) {
      emailRef.current?.focus();
      return;
    }

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
        const errorMessage = data.error ?? 'Failed to send reset link. Please try again.';
        setServerError(errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server. Please try again.';
      setServerError(errorMessage);
      console.error('[ForgotPassword] Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Show success message after email is sent
  if (emailSent) {
    return (
      <AuthShell
        eyebrow="RECOVERY DISPATCHED"
        title="Check your inbox"
        statusLabel="LINK SENT"
        statusTone="success"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-[var(--status-stable-bg)] border border-[var(--status-stable-border)] rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-[var(--status-stable-fg)]"><Check className="w-8 h-8" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          <p className="text-(--text-primary) mb-6">
            If an account exists with that email, a password reset link has been sent.
          </p>
          <p className="text-sm text-(--text-tertiary) mb-6">
            In development, check the server console for the reset link.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center text-sm text-(--text-primary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
            <span className="ml-2">Back to sign in</span>
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="PASSWORD RECOVERY"
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a link to reset your password."
      statusLabel={isLoading ? 'DISPATCHING' : serverError ? 'REQUEST FAILED' : 'AWAITING INPUT'}
      statusTone={isLoading ? 'busy' : serverError ? 'error' : 'idle'}
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Email Field */}
        <div className="relative">
          <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none">
            <Mail className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <Input
            ref={emailRef}
            id="email"
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (serverError) setServerError(''); }}
            onBlur={() => setTouched(true)}
            className="pl-10"
            placeholder="Enter your email"
            error={emailFieldError || undefined}
            required
          />
        </div>

        {/* Server Error */}
        {serverError && (
          <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--status-critical-fg)]" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-sm text-[var(--status-critical-fg)]" role="alert">{serverError}</p>
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading} disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send Reset Link'}
        </Button>
      </form>

      {/* Back to Login */}
      <div className="mt-6 flex justify-center">
        <Link
          to="/login"
          className="inline-flex items-center text-sm text-(--text-tertiary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
          <span className="ml-2">Back to sign in</span>
        </Link>
      </div>
    </AuthShell>
  );
}
