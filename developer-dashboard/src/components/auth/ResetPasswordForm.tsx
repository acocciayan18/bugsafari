import { useState, type FormEvent } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../ui/Button';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

// Icons
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

const ArrowLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

const XCircleIcon = () => (
  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

interface ResetPasswordResponse {
  ok?: boolean;
  message?: string;
  error?: string;
}

export default function ResetPasswordForm() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const emailParam = searchParams.get('email') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Validate token presence on mount
  if (!token || !emailParam) {
    return (
      <div className="min-h-screen bg-[var(--surface-app)] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-[var(--surface-panel)] p-6 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] border border-[var(--border-hairline)] text-center">
            <div className="w-16 h-16 bg-[var(--status-critical-bg)] border border-[var(--status-critical-border)] rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-[var(--status-critical-fg)]"><XCircleIcon /></span>
            </div>
            <p className="text-xs font-mono font-medium tracking-[0.14em] text-[var(--text-tertiary)] mb-2">TOKEN REJECTED</p>
            <h2 className="text-h4 font-semibold text-[var(--text-primary)] mb-2">Invalid reset link</h2>
            <p className="text-[var(--text-secondary)] mb-6">
              This password reset link is invalid or has expired.
            </p>
            <Link
              to="/forgot-password"
              className="inline-flex items-center text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
            >
              <ArrowLeftIcon />
              <span className="ml-2">Request a new reset link</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    // Validate password complexity
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setFormError('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setFormError('Password must contain at least one number');
      return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      setFormError('Password must contain at least one special character');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailParam,
          token: token,
          newPassword: password,
        }),
      });

      const data: ResetPasswordResponse = await response.json();

      if (response.ok && data.ok) {
        toast.success('Password reset successfully!');
        // Redirect to login after short delay
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      } else {
        const errorMessage = data.error ?? 'Failed to reset password';
        setFormError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      setFormError(errorMessage);
      toast.error(errorMessage);
      console.error('[ResetPassword] Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface-app)] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[var(--surface-panel)] p-6 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] border border-[var(--border-hairline)]">
          <p className="text-center text-xs font-mono font-medium tracking-[0.14em] text-[var(--text-tertiary)] mb-2">CREDENTIAL RESET</p>
          <h2 className="text-h4 font-semibold text-[var(--text-primary)] text-center mb-2">Reset password</h2>
          <p className="text-base text-[var(--text-secondary)] text-center mb-6">
            Enter your new password below.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-[var(--text-tertiary)] pointer-events-none">
                  <LockClosedIcon />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-panel)] px-4 pl-10 pr-10 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* Confirm Password Field */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-[var(--text-tertiary)] pointer-events-none">
                  <LockClosedIcon />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-10 rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-panel)] px-4 pl-10 pr-10 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {formError && (
              <div className="p-3 bg-[var(--status-critical-bg)] border border-[var(--status-critical-border)] rounded-[var(--radius-sm)]">
                <p className="text-sm text-[var(--status-critical-fg)]">{formError}</p>
              </div>
            )}

            {/* Password Requirements */}
            <div className="p-3 bg-[var(--surface-inset)] border border-[var(--border-hairline)] rounded-[var(--radius-sm)]">
              <p className="text-xs text-[var(--text-secondary)] mb-2 font-medium">Password must contain:</p>
              <ul className="text-xs text-[var(--text-tertiary)] space-y-1">
                <li className={password.length >= 8 ? 'text-[var(--status-stable-fg)]' : ''}>
                  {password.length >= 8 ? '✓' : '○'} At least 8 characters
                </li>
                <li className={/[A-Z]/.test(password) ? 'text-[var(--status-stable-fg)]' : ''}>
                  {/[A-Z]/.test(password) ? '✓' : '○'} One uppercase letter (A-Z)
                </li>
                <li className={/[0-9]/.test(password) ? 'text-[var(--status-stable-fg)]' : ''}>
                  {/[0-9]/.test(password) ? '✓' : '○'} One number (0-9)
                </li>
                <li className={/[^A-Za-z0-9]/.test(password) ? 'text-[var(--status-stable-fg)]' : ''}>
                  {/[^A-Za-z0-9]/.test(password) ? '✓' : '○'} One special character
                </li>
              </ul>
            </div>

            {/* Submit Button */}
            <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading}>
              {isLoading ? 'Resetting...' : 'Reset Password'}
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
