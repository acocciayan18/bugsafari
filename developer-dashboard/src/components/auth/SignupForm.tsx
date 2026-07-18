import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LockClosedIcon, EyeIcon, EyeSlashIcon, WarningIcon } from '../icons';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

const EnvelopeIcon = () => (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v11.25a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const GoogleIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.233 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 19.002 13 24 13c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4c-7.682 0-14.347 4.337-17.694 10.691z" />
    <path fill="#4CAF50" d="M24 44c5.176 0 9.944-1.977 13.545-5.197l-6.26-5.298C29.268 35.091 26.761 36 24 36c-5.211 0-9.617-3.316-11.283-7.946l-6.522 5.024C9.509 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 01-4.018 5.505l.003-.002 6.26 5.298C37.102 39.2 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

interface RequirementRowProps {
  met: boolean;
  label: string;
}

function RequirementRow({ met, label }: RequirementRowProps) {
  return (
    <div className={`text-xs font-medium flex items-center gap-2 ${met ? 'text-[var(--status-stable-fg)]' : 'text-[var(--status-critical-fg)]'}`}>
      {met ? <CheckIcon /> : <WarningIcon className="w-4 h-4" />}
      <span>{label}</span>
    </div>
  );
}

export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigate = useNavigate();
  const { signup, isLoading, setNavigate: setAuthNavigate } = useAuth();

  useEffect(() => {
    setAuthNavigate(navigate);
  }, [navigate, setAuthNavigate]);

  const hasMinLength = password.length >= 8;
  const hasSymbol = /[_!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!email.trim() || !email.includes('@')) return setFormError('Please enter a valid email address.');
    if (!password || password.length < 8) return setFormError('Password must be at least 8 characters.');
    if (!hasSymbol || !hasNumber) return setFormError('Password must include symbols and numbers.');
    if (password !== confirmPassword) return setFormError('Passwords do not match.');

    try {
      const success = await signup({ email: email.trim(), password });
      if (!success) setFormError('Registration failed. Please try again.');
    } catch (err) {
      console.error('[SignupForm] Signup error:', err);
      setFormError('Unable to connect to server. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--surface-app)]">
      <div className="w-full max-w-[420px]">
        <div className="bg-[var(--surface-panel)] border border-[var(--border-hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] p-6">
          <p className="text-center text-xs font-mono font-medium tracking-[0.14em] text-[var(--text-tertiary)] mb-2">NEW OPERATOR REGISTRATION</p>
          <h1 className="text-center text-h2 font-semibold text-[var(--text-primary)] mb-2">Create account</h1>
          <p className="text-center text-body-sm text-[var(--text-secondary)] mb-7">Register credentials to start streaming evaluation safaris.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-[var(--text-tertiary)] pointer-events-none"><EnvelopeIcon /></span>
              <Input
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@company.com"
                className="pl-10"
                required
              />
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-[var(--text-tertiary)] pointer-events-none"><LockClosedIcon className="w-[18px] h-[18px]" /></span>
              <Input
                id="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-[var(--text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
              >
                {showPassword ? <EyeSlashIcon className="w-[18px] h-[18px]" /> : <EyeIcon className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-[var(--text-tertiary)] pointer-events-none"><LockClosedIcon className="w-[18px] h-[18px]" /></span>
              <Input
                id="confirmPassword"
                label="Confirm Password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-[var(--text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
              >
                {showConfirmPassword ? <EyeSlashIcon className="w-[18px] h-[18px]" /> : <EyeIcon className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-inset)] p-4">
              <p className="text-xs font-mono font-medium tracking-[0.08em] text-[var(--text-secondary)] mb-2">SECURITY REQUIREMENTS</p>
              <div className="space-y-1.5">
                <RequirementRow met={hasMinLength} label="At least 8 characters long" />
                <RequirementRow met={hasSymbol} label="Include 1 special character (@, #, $)" />
                <RequirementRow met={hasNumber} label="Include at least one number" />
              </div>
            </div>

            {formError && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2">
                <p className="text-sm text-[var(--status-critical-fg)]">{formError}</p>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              isLoading={isLoading}
              disabled={!email || !password || !confirmPassword || !hasMinLength || !hasSymbol || !hasNumber || password !== confirmPassword}
            >
              {isLoading ? 'Creating account...' : 'Create Account'}
            </Button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border-hairline)]" />
              <span className="text-xs font-mono tracking-[0.14em] text-[var(--text-tertiary)]">OR</span>
              <div className="h-px flex-1 bg-[var(--border-hairline)]" />
            </div>

            <Button type="button" variant="secondary" size="md" className="w-full !text-[var(--text-primary)]">
              <GoogleIcon />
              <span>Sign up with Google</span>
            </Button>
          </form>
        </div>
        <div className="mt-5 text-center text-sm text-[var(--text-secondary)]">
          Already have an account? <Link to="/login" className="text-[var(--text-primary)] font-medium hover:underline underline-offset-2">Log in</Link>
        </div>
      </div>
    </div>
  );
}
