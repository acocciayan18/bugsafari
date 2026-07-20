import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, AlertCircle,  Lock, Eye, EyeOff, } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';
import PasswordRequirements, { isPasswordValid } from './PasswordRequirements';
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

  const consentRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const { signup, isLoading, emailError, authError, clearEmailError, clearAuthError, setNavigate: setAuthNavigate } = useAuth();

  useEffect(() => {
    setAuthNavigate(navigate);
  }, [navigate, setAuthNavigate]);

  const markTouched = (field: keyof TouchedState) => () => setTouched((t) => ({ ...t, [field]: true }));

  const emailFormatValid = email.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = isPasswordValid(password);
  const confirmMatches = confirmPassword.length > 0 && password === confirmPassword;

  const showEmailError = (touched.email || submitted) && email.trim().length > 0 && !emailFormatValid
    ? 'Enter a valid email address, like name@company.com.'
    : (touched.email || submitted) && email.trim().length === 0
    ? 'Email is required.'
    : '';
  const emailErrorMessage = emailError || showEmailError;

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    clearEmailError();
    clearAuthError();

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
      await signup({ email: email.trim(), password });
    } catch (err) {
      console.error('[SignupForm] Signup error:', err);
    }
  };

  return (
    <AuthShell
      eyebrow="NEW USER REGISTRATION"
      title="Create account"
      subtitle="Register credentials to start streaming evaluation safaris."
      statusLabel={isLoading ? 'PROVISIONING' : authError || emailError ? 'REGISTRATION FAILED' : 'AWAITING INPUT'}
      statusTone={isLoading ? 'busy' : authError || emailError ? 'error' : 'idle'}
      footer={
        <>
          <div className="mt-5 text-center text-sm text-(--text-primary)">
            Already have an account? <Link to="/login" className="text-(--text-primary) font-medium hover:underline underline-offset-2">Log in</Link>
          </div>
          <LegalFooter onOpenDoc={setOpenDocId} />
          <LegalDocModal docId={openDocId} onClose={() => setOpenDocId(null)} />
        </>
      }
    >
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><Mail className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /></span>
              <Input
                ref={emailRef}
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) clearEmailError(); }}
                onBlur={markTouched('email')}
                placeholder="example@email.com"
                className="pl-10 font-(--font-sans)"
                error={emailErrorMessage || undefined}
                required
              />
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><Lock className="w-4 h-4 shrink-0" /></span>
              <Input
                ref={passwordRef}
                id="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={markTouched('password')}
                placeholder="••••••••"
                className="pl-10 pr-10"
                error={showPasswordError || undefined}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-(--text-tertiary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)"
              >
                {showPassword ? <EyeOff className="w-4 h-4 shrink-0" /> : <Eye className="w-4 h-4 shrink-0" />}
              </button>
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><Lock className="w-4 h-4 shrink-0" /></span>
              <Input
                ref={confirmPasswordRef}
                id="confirmPassword"
                label="Confirm Password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={markTouched('confirmPassword')}
                placeholder="••••••••"
                className="pl-10 pr-10"
                error={showConfirmError || undefined}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-(--text-tertiary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4 shrink-0" /> : <Eye className="w-4 h-4 shrink-0" />}
              </button>
            </div>

            <PasswordRequirements password={password} />

            <div>
              <div className="flex items-start gap-2.5">
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
                <p className="text-[13px] leading-relaxed text-(--text-secondary)">
                  <label htmlFor="accept-policies" className="cursor-pointer">
                    I have read and agree to the
                  </label>{' '}
                  <button type="button" onClick={() => setOpenDocId('privacy')} className="font-medium text-(--text-primary) underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)">
                    Privacy Notice
                  </button>{' '}
                  and{' '}
                  <button type="button" onClick={() => setOpenDocId('terms')} className="font-medium text-(--text-primary) underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)">
                    Terms of Use
                  </button>
                  , and confirm I will only test systems I am authorized to test.
                </p>
              </div>
              {consentError && (
                <p id="accept-policies-error" className="mt-1.5 text-[13px] text-(--status-critical-fg)">
                  {consentError}
                </p>
              )}
            </div>

            {(authError || emailError) && (
              <div className="flex items-start gap-2 rounded-(--radius-sm) border border-(--status-critical-border) bg-(--status-critical-bg) px-3 py-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-(--status-critical-fg)" strokeWidth={1.75} aria-hidden="true" />
                <p className="text-sm text-(--status-critical-fg)" role="alert">{authError || emailError}</p>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
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
