import { useState, useRef, type FormEvent } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleX, Eye, EyeOff, Lock } from 'lucide-react';
import { AUTH_SUCCESS, authSuccessToast } from '../../infrastructure/notifications/authToasts';
import { buildFeedback, postAuth, type AuthFeedback } from '../../utils/authFeedback';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';
import AuthAlert from './AuthAlert';
import PasswordRequirements, { isPasswordValid } from './PasswordRequirements';
import { PASSWORD_MAX_LENGTH } from '../../utils/authLimits';

interface ResetPasswordResponse {
  ok?: boolean;
  message?: string;
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
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  // Validate token presence on mount
  if (!token || !emailParam) {
    return (
      <AuthShell
        eyebrow="TOKEN REJECTED"
        title="Invalid reset link"
      >
        <div className="text-center">
          <div className="w-16 h-16 sm:w-[72px] sm:h-[72px] shrink-0 bg-(--status-critical-bg) ring-1 ring-(--status-critical-border) rounded-full flex items-center justify-center mx-auto mb-5 shadow-(--shadow-sm)">
            <span className="text-(--status-critical-fg)"><CircleX className="w-8 h-8 sm:w-9 sm:h-9" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          <p className="text-base leading-relaxed text-(--text-primary) mb-6 max-w-[38ch] mx-auto">
            This password reset link is invalid or has expired.
          </p>
          <div className="pt-5 border-t border-(--border-hairline)">
            <Link
              to="/forgot-password"
              className="inline-flex items-center gap-2 text-[13px] font-medium text-(--text-primary) hover:opacity-80 transition-opacity duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm) px-1 py-0.5"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              Request a new reset link
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  const passwordValid = isPasswordValid(password);
  const confirmMatches = confirmPassword.length > 0 && password === confirmPassword;

  const passwordError = (touchedPassword || submitted) && password.length > 0 && !passwordValid
    ? 'Password does not meet all requirements below.'
    : (touchedPassword || submitted) && password.length === 0
    ? 'Password is required.'
    : '';

  const confirmError = (touchedConfirm || submitted) && confirmPassword.length > 0 && !confirmMatches
    ? 'Passwords do not match.'
    : (touchedConfirm || submitted) && confirmPassword.length === 0
    ? 'Please confirm your password.'
    : '';

  // Shared field skin so every input stays pixel-identical with the other auth screens.
  const fieldBase = 'peer w-full h-11 rounded-(--radius-sm) border bg-(--surface-panel) pl-10 pr-11 text-base text-(--text-primary) placeholder:text-(--text-tertiary) transition-[color,border-color,box-shadow] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-1 focus:ring-(--border-focus)';
  const fieldBorder = (invalid: boolean) => (invalid ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)');
  const iconClass = 'absolute inset-y-0 left-3 flex items-center text-(--text-tertiary) peer-focus:text-(--text-primary) transition-colors pointer-events-none';
  const eyeClass = 'absolute inset-y-0 right-0 flex w-11 items-center justify-center text-(--text-tertiary) hover:text-(--text-primary) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFeedback(null);

    if (!passwordValid) {
      passwordRef.current?.focus();
      return;
    }
    if (!confirmMatches) {
      confirmPasswordRef.current?.focus();
      return;
    }

    setIsLoading(true);
    const result = await postAuth<ResetPasswordResponse>('/api/auth/reset-password', {
      email: emailParam,
      token,
      newPassword: password,
    });

    if (!result.ok) {
      setIsLoading(false);
      setFeedback(result.feedback);
      return;
    }

    if (!result.data.ok) {
      setIsLoading(false);
      console.error('[ResetPassword] 200 response without an ok flag:', result.data);
      setFeedback(buildFeedback('UNEXPECTED_RESPONSE'));
      return;
    }

    // Stay disabled through the bounce — the password is already rotated, so a
    // second submit would only fail against a now-consumed token.
    authSuccessToast(AUTH_SUCCESS.passwordReset);
    setTimeout(() => navigate('/login'), 2000);
  };

  return (
    <AuthShell
      eyebrow="CREDENTIAL RESET"
      title="Reset password"
      subtitle="Enter your new password below."
    >
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-(--text-primary) mb-1.5">
                New Password
              </label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (feedback) setFeedback(null); }}
                  onBlur={() => setTouchedPassword(true)}
                  aria-invalid={!!passwordError || feedback?.field === 'password'}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                  maxLength={PASSWORD_MAX_LENGTH}
                  autoComplete="new-password"
                  className={`${fieldBase} ${fieldBorder(!!passwordError || feedback?.field === 'password')}`}
                  placeholder="••••••••"
                  required
                />
                <span className={iconClass}><Lock className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /></span>
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className={eyeClass}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : <Eye className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
                </button>
              </div>
              {passwordError && <p id="password-error" className="mt-1.5 text-[13px] text-(--status-critical-fg)">{passwordError}</p>}
            </div>

            {/* Confirm Password Field */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-(--text-primary) mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  ref={confirmPasswordRef}
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => setTouchedConfirm(true)}
                  aria-invalid={!!confirmError}
                  aria-describedby={confirmError ? 'confirmPassword-error' : undefined}
                  maxLength={PASSWORD_MAX_LENGTH}
                  autoComplete="new-password"
                  className={`${fieldBase} ${fieldBorder(!!confirmError)}`}
                  placeholder="••••••••"
                  required
                />
                <span className={iconClass}><Lock className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /></span>
                <button
                  type="button"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  className={eyeClass}
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : <Eye className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
                </button>
              </div>
              {confirmError && <p id="confirmPassword-error" className="mt-1.5 text-[13px] text-(--status-critical-fg)">{confirmError}</p>}
            </div>

            {/* Password Requirements */}
            <PasswordRequirements password={password} />

            <AuthAlert feedback={feedback} />

            {/* Submit Button */}
            <Button type="submit" variant="primary" size="lg" className="w-full" isLoading={isLoading} disabled={isLoading}>
              {isLoading ? 'Resetting...' : 'Reset Password'}
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
