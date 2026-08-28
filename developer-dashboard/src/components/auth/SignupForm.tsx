import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MailCheck, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';
import AuthAlert from './AuthAlert';
import PasswordRequirements, { isPasswordValid } from './PasswordRequirements';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH } from '../../utils/authLimits';
import LegalFooter from '../legal/LegalFooter';
import LegalDocModal from '../legal/LegalDocModal';
import type { LegalDocId } from '../../legal/content';

interface TouchedState {
  email: boolean;
  password: boolean;
  confirmPassword: boolean;
}

export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState<TouchedState>({ email: false, password: false, confirmPassword: false });
  const [submitted, setSubmitted] = useState(false);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [openDocId, setOpenDocId] = useState<LegalDocId | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [sentToEmail, setSentToEmail] = useState('');

  const consentRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const { signup, isLoading, authError, clearAuthError, setNavigate: setAuthNavigate } = useAuth();

  useEffect(() => {
    if (setAuthNavigate) {
      setAuthNavigate(navigate);
    }
  }, [navigate, setAuthNavigate]);

  // authError is one shared store field, so a failure left behind by /login would
  // still be mounted here. Each auth screen starts from a clean slate.
  useEffect(() => {
    clearAuthError();
  }, [clearAuthError]);

  const markTouched = (field: keyof TouchedState) => () => setTouched((t) => ({ ...t, [field]: true }));

  const emailFormatValid = email.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = isPasswordValid(password);
  const confirmMatches = confirmPassword.length > 0 && password === confirmPassword;

  const showEmailError = (touched.email || submitted) && email.trim().length > 0 && !emailFormatValid
    ? 'Enter a valid email address, like name@company.com.'
    : (touched.email || submitted) && email.trim().length === 0
    ? 'Email is required.'
    : '';

  const showPasswordError = (touched.password || submitted) && password.length > 0 && !passwordValid
    ? 'Password does not meet all requirements below.'
    : (touched.password || submitted) && password.length === 0
    ? 'Password is required.'
    : '';

  const consentError = submitted && !acceptedPolicies
    ? 'You must accept the Privacy Notice and Terms of Use to create an account.'
    : '';

  const showConfirmError = (touched.confirmPassword || submitted) && confirmPassword.length > 0 && !confirmMatches
    ? 'Passwords do not match.'
    : (touched.confirmPassword || submitted) && confirmPassword.length === 0
    ? 'Please confirm your password.'
    : '';

  const emailInvalid = !!showEmailError || authError?.field === 'email';
  const passwordInvalid = !!showPasswordError || authError?.field === 'password';
  const confirmInvalid = !!showConfirmError;

  // Shared field skin so every input stays pixel-identical.
  const fieldBase = 'peer w-full h-11 rounded-(--radius-sm) border bg-(--surface-panel) pl-10 pr-11 text-base text-(--text-primary) placeholder:text-(--text-tertiary) transition-[color,border-color,box-shadow] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-1 focus:ring-(--border-focus)';
  const fieldBorder = (invalid: boolean) => (invalid ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)');
  const iconClass = 'absolute inset-y-0 left-3 flex items-center text-(--text-tertiary) peer-focus:text-(--text-primary) transition-colors pointer-events-none';
  const eyeClass = 'absolute inset-y-0 right-0 flex w-11 items-center justify-center text-(--text-tertiary) hover:text-(--text-primary) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (clearAuthError) clearAuthError();

    if (!emailFormatValid) {
      emailRef.current?.focus();
      return;
    }
    if (!passwordValid) {
      passwordRef.current?.focus();
      return;
    }
    if (!confirmMatches) {
      confirmPasswordRef.current?.focus();
      return;
    }
    if (!acceptedPolicies) {
      consentRef.current?.focus();
      return;
    }

    try {
      const ok = await signup({ email: email.trim(), password });
      if (ok) {
        setSentToEmail(email.trim());
        setVerificationSent(true);
      }
    } catch (err) {
      console.error('[SignupForm] Signup error:', err);
    }
  };

  // Post-signup: the account exists but is unverified, so we show a terminal
  // "check your inbox" screen rather than treating the user as signed in.
  if (verificationSent) {
    return (
      <AuthShell eyebrow="VERIFY YOUR EMAIL" title="Check your inbox">
        <div className="text-center">
          <div className="w-16 h-16 sm:w-[72px] sm:h-[72px] shrink-0 bg-(--status-stable-bg) ring-1 ring-(--status-stable-border) rounded-full flex items-center justify-center mx-auto mb-5 shadow-(--shadow-sm)">
            <span className="text-(--status-stable-fg)"><MailCheck className="w-8 h-8 sm:w-9 sm:h-9" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          <p className="text-base leading-relaxed text-(--text-primary) mb-2 max-w-[40ch] mx-auto">
            We sent a verification link to <span className="font-medium break-all">{sentToEmail}</span>.
          </p>
          <p className="text-[13px] leading-relaxed text-(--text-tertiary) mb-6 max-w-[40ch] mx-auto">
            Open it to activate your account and sign in. Check your spam folder if it hasn't arrived.
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
      eyebrow="NEW USER REGISTRATION"
      title="Create Account"
      subtitle="Create an account to start running exploratory tests."
      footer={
        <>
          <div className="mt-6 pt-5 border-t border-(--border-hairline) text-center text-sm text-(--text-primary)">
            Already have an account? <Link to="/login" className="text-(--text-primary) font-medium hover:underline underline-offset-2">Log in</Link>
          </div>
          <LegalFooter onOpenDoc={setOpenDocId} />
          <LegalDocModal docId={openDocId} onClose={() => setOpenDocId(null)} />
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="email" className="block mb-1.5 text-sm font-medium text-(--text-primary)">Email</label>
          <div className="relative">
            <input
              ref={emailRef}
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (authError) clearAuthError();
              }}
              onBlur={markTouched('email')}
              placeholder="example@email.com"
              aria-invalid={emailInvalid}
              aria-describedby={showEmailError ? 'email-error' : undefined}
              maxLength={EMAIL_MAX_LENGTH}
              autoComplete="email"
              className={`${fieldBase} ${fieldBorder(emailInvalid)}`}
              required
            />
            <span className={iconClass}><Mail className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          {showEmailError && <p id="email-error" className="mt-1.5 text-sm text-(--status-critical-fg)">{showEmailError}</p>}
        </div>

        <div>
          <label htmlFor="password" className="block mb-1.5 text-sm font-medium text-(--text-primary)">Password</label>
          <div className="relative">
            <input
              ref={passwordRef}
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (authError) clearAuthError(); }}
              onBlur={markTouched('password')}
              placeholder="••••••••"
              aria-invalid={passwordInvalid}
              aria-describedby={showPasswordError ? 'password-error' : undefined}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              className={`${fieldBase} ${fieldBorder(passwordInvalid)}`}
              required
            />
            <span className={iconClass}><Lock className="w-4 h-4 shrink-0" /></span>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className={eyeClass}
            >
              {showPassword ? <EyeOff className="w-4 h-4 shrink-0" /> : <Eye className="w-4 h-4 shrink-0" />}
            </button>
          </div>
          {showPasswordError && <p id="password-error" className="mt-1.5 text-sm text-(--status-critical-fg)">{showPasswordError}</p>}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block mb-1.5 text-sm font-medium text-(--text-primary)">Confirm Password</label>
          <div className="relative">
            <input
              ref={confirmPasswordRef}
              id="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={markTouched('confirmPassword')}
              placeholder="••••••••"
              aria-invalid={confirmInvalid}
              aria-describedby={showConfirmError ? 'confirmPassword-error' : undefined}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              className={`${fieldBase} ${fieldBorder(confirmInvalid)}`}
              required
            />
            <span className={iconClass}><Lock className="w-4 h-4 shrink-0" /></span>
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              className={eyeClass}
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4 shrink-0" /> : <Eye className="w-4 h-4 shrink-0" />}
            </button>
          </div>
          {showConfirmError && <p id="confirmPassword-error" className="mt-1.5 text-sm text-(--status-critical-fg)">{showConfirmError}</p>}
        </div>

        <PasswordRequirements password={password} />

        <div>
          <div className={`flex items-start gap-3 rounded-(--radius-sm) border bg-(--surface-app)/40 p-3 transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] ${consentError ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)'}`}>
            <input
              ref={consentRef}
              id="accept-policies"
              type="checkbox"
              checked={acceptedPolicies}
              onChange={(e) => setAcceptedPolicies(e.target.checked)}
              aria-invalid={!!consentError}
              aria-describedby={consentError ? 'accept-policies-error' : undefined}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-(--surface-invert) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
            />
            <p className="text-sm leading-relaxed text-(--text-secondary)">
              <label htmlFor="accept-policies" className="cursor-pointer">
                I have read and agree to the
              </label>{' '}
              <button type="button" onClick={() => setOpenDocId('privacy')} className="font-medium text-(--text-primary) cursor-pointer underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)">
                Privacy Notice
              </button>{' '}
              and{' '}
              <button type="button" onClick={() => setOpenDocId('terms')} className="font-medium text-(--text-primary) cursor-pointer underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)">
                Terms of Use
              </button>
              , and confirm I will only test systems I am authorized to test.
            </p>
          </div>
          {consentError && (
            <p id="accept-policies-error" className="mt-1.5 text-xs text-(--status-critical-fg)">
              {consentError}
            </p>
          )}
        </div>

        <AuthAlert feedback={authError} />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          isLoading={isLoading}
          disabled={isLoading}
        >
          {isLoading ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>
    </AuthShell>
  );
}