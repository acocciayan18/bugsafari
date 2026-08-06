import { useState, useRef, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Mail } from 'lucide-react';
import { AUTH_SUCCESS, authSuccessToast } from '../../infrastructure/notifications/authToasts';
import { buildFeedback, postAuth, type AuthFeedback } from '../../utils/authFeedback';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import AuthShell from './AuthShell';
import AuthAlert from './AuthAlert';
import { EMAIL_MAX_LENGTH } from '../../utils/authLimits';

interface ForgotPasswordResponse {
  ok?: boolean;
  message?: string;
}

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
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
    setFeedback(null);

    if (!emailFormatValid) {
      emailRef.current?.focus();
      return;
    }

    setIsLoading(true);
    const result = await postAuth<ForgotPasswordResponse>('/api/auth/forgot-password', { email: email.trim() });
    setIsLoading(false);

    if (!result.ok) {
      setFeedback(result.feedback);
      return;
    }

    // The route answers 200 for unknown emails too (anti-enumeration) — `ok`
    // missing therefore means a malformed payload, not a rejected address.
    if (!result.data.ok) {
      console.error('[ForgotPassword] 200 response without an ok flag:', result.data);
      setFeedback(buildFeedback('UNEXPECTED_RESPONSE'));
      return;
    }

    setEmailSent(true);
    authSuccessToast(AUTH_SUCCESS.resetLinkSent);
  };

  // Show success message after email is sent
  if (emailSent) {
    return (
      <AuthShell
        eyebrow="RECOVERY DISPATCHED"
        title="Check your inbox"
      >
        <div className="text-center">
          <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 bg-(--status-stable-bg) border border-(--status-stable-border) rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-(--status-stable-fg)"><Check className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          <p className="text-(--text-primary) mb-5 sm:mb-6">
            If an account exists with that email, a password reset link has been sent.
          </p>
          <p className="text-[13px] text-(--text-tertiary) mb-6">
            The link expires in 1 hour. Check your spam folder if it hasn't arrived.
          </p>
          <Link
            to="/login"
            className="inline-flex items-center text-[13px] text-(--text-primary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
          >
            <ArrowLeft className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
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
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Email Field */}
        <div className="relative">
          <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none">
            <Mail className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <Input
            ref={emailRef}
            id="email"
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (feedback) setFeedback(null); }}
            onBlur={() => setTouched(true)}
            className="pl-10"
            placeholder="Enter your email"
            error={emailFieldError || undefined}
            invalid={feedback?.field === 'email'}
            maxLength={EMAIL_MAX_LENGTH}
            autoComplete="email"
            required
          />
        </div>

        <AuthAlert feedback={feedback} />

        {/* Submit Button */}
        <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading} disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send Reset Link'}
        </Button>
      </form>

      {/* Back to Login */}
      <div className="mt-6 flex justify-center">
        <Link
          to="/login"
          className="inline-flex items-center text-[13px] text-(--text-tertiary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
          <span className="ml-2">Back to sign in</span>
        </Link>
      </div>
    </AuthShell>
  );
}
