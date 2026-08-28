import { useState, useRef, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Mail } from 'lucide-react';
import { AUTH_SUCCESS, authSuccessToast } from '../../infrastructure/notifications/authToasts';
import { buildFeedback, postAuth, type AuthFeedback } from '../../utils/authFeedback';
import { Button } from '../ui/Button';
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
  const emailInvalid = !!emailFieldError || feedback?.field === 'email';

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
          <div className="w-16 h-16 sm:w-[72px] sm:h-[72px] shrink-0 bg-(--status-stable-bg) ring-1 ring-(--status-stable-border) rounded-full flex items-center justify-center mx-auto mb-5 shadow-(--shadow-sm)">
            <span className="text-(--status-stable-fg)"><Check className="w-8 h-8 sm:w-9 sm:h-9" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          <p className="text-base leading-relaxed text-(--text-primary) mb-2 max-w-[38ch] mx-auto">
            If an account exists with that email, a password reset link has been sent.
          </p>
          <p className="text-[13px] leading-relaxed text-(--text-tertiary) mb-6 max-w-[38ch] mx-auto">
            The link expires in 1 hour. Check your spam folder if it hasn't arrived.
          </p>
          <div className="pt-5 border-t border-(--border-hairline)">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-[13px] font-medium text-(--text-primary) hover:opacity-80 transition-opacity duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm) px-1 py-0.5"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              Back to sign in
            </Link>
          </div>
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
        <div>
          <label htmlFor="email" className="block mb-1.5 text-sm font-medium text-(--text-primary)">Email Address</label>
          <div className="relative">
            <input
              ref={emailRef}
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (feedback) setFeedback(null); }}
              onBlur={() => setTouched(true)}
              placeholder="example@email.com"
              aria-invalid={emailInvalid}
              aria-describedby={emailFieldError ? 'email-error' : undefined}
              maxLength={EMAIL_MAX_LENGTH}
              autoComplete="email"
              className={`peer w-full h-11 rounded-(--radius-sm) border bg-(--surface-panel) pl-10 pr-4 text-base text-(--text-primary) placeholder:text-(--text-tertiary) transition-[color,border-color,box-shadow] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-1 focus:ring-(--border-focus) ${emailInvalid ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)'}`}
              required
            />
            <span className="absolute inset-y-0 left-3 flex items-center text-(--text-tertiary) peer-focus:text-(--text-primary) transition-colors pointer-events-none">
              <Mail className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            </span>
          </div>
          {emailFieldError
            ? <p id="email-error" className="mt-1.5 text-sm text-(--status-critical-fg)">{emailFieldError}</p>
            : <p className="mt-1.5 text-[13px] leading-relaxed text-(--text-tertiary)">We'll email a reset link to this address.</p>}
        </div>

        <AuthAlert feedback={feedback} />

        <Button type="submit" variant="primary" size="lg" className="w-full" isLoading={isLoading} disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send Reset Link'}
        </Button>
      </form>

      {/* Back to Login */}
      <div className="mt-6 pt-5 border-t border-(--border-hairline) flex justify-center">
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-[13px] font-medium text-(--text-tertiary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm) px-1 py-0.5"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
