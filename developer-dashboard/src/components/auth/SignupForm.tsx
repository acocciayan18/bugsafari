import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LockClosedIcon, EyeIcon, EyeSlashIcon } from '../icons';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';
import PasswordRequirements, { isPasswordValid } from './PasswordRequirements';

const GoogleIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.233 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 19.002 13 24 13c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4c-7.682 0-14.347 4.337-17.694 10.691z" />
    <path fill="#4CAF50" d="M24 44c5.176 0 9.944-1.977 13.545-5.197l-6.26-5.298C29.268 35.091 26.761 36 24 36c-5.211 0-9.617-3.316-11.283-7.946l-6.522 5.024C9.509 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 01-4.018 5.505l.003-.002 6.26 5.298C37.102 39.2 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

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
      maxWidth="max-w-[420px]"
      statusLabel={isLoading ? 'PROVISIONING' : authError || emailError ? 'REGISTRATION FAILED' : 'AWAITING INPUT'}
      statusTone={isLoading ? 'busy' : authError || emailError ? 'error' : 'idle'}
      footer={
        <div className="mt-5 text-center text-sm text-(--text-primary)">
          Already have an account? <Link to="/login" className="text-(--text-primary) font-medium hover:underline underline-offset-2">Log in</Link>
        </div>
      }
    >
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><Mail className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden="true" /></span>
              <Input
                ref={emailRef}
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) clearEmailError(); }}
                onBlur={markTouched('email')}
                placeholder="john@company.com"
                className="pl-10 font-(--font-sans)"
                error={emailErrorMessage || undefined}
                required
              />
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><LockClosedIcon className="w-[18px] h-[18px]" /></span>
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
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-(--text-tertiary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
              >
                {showPassword ? <EyeSlashIcon className="w-[18px] h-[18px]" /> : <EyeIcon className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><LockClosedIcon className="w-[18px] h-[18px]" /></span>
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
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-(--text-tertiary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
              >
                {showConfirmPassword ? <EyeSlashIcon className="w-[18px] h-[18px]" /> : <EyeIcon className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <PasswordRequirements password={password} />

            {(authError || emailError) && (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--status-critical-fg)]" strokeWidth={1.75} aria-hidden="true" />
                <p className="text-sm text-[var(--status-critical-fg)]" role="alert">{authError || emailError}</p>
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

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border-hairline)]" />
              <span className="text-xs font-mono tracking-[0.14em] text-(--text-tertiary)">OR</span>
              <div className="h-px flex-1 bg-[var(--border-hairline)]" />
            </div>

            <Button type="button" variant="secondary" size="md" className="w-full !text-(--text-primary)">
              <GoogleIcon />
              <span>Sign up with Google</span>
            </Button>
          </form>
    </AuthShell>
  );
}
