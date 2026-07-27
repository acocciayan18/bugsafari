import { useState, useRef, type FormEvent } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleX, Eye, EyeOff, Lock } from 'lucide-react';
import { AUTH_SUCCESS, authSuccessToast } from '../../infrastructure/notifications/authToasts';
import { buildFeedback, postAuth, type AuthFeedback } from '../../utils/authFeedback';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';
import AuthAlert from './AuthAlert';
import PasswordRequirements, { isPasswordValid } from './PasswordRequirements';

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
          <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 bg-(--status-critical-bg) border border-(--status-critical-border) rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-(--status-critical-fg)"><CircleX className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          <p className="text-(--text-primary) mb-5 sm:mb-6">
            This password reset link is invalid or has expired.
          </p>
          <Link
            to="/forgot-password"
            className="inline-flex items-center text-[13px] text-(--text-primary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
          >
            <ArrowLeft className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="ml-2">Request a new reset link</span>
          </Link>
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
              <label htmlFor="password" className="block text-[13px] font-medium text-(--text-primary) mb-1.5">
                New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-(--text-tertiary) pointer-events-none">
                  <Lock className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <input
                  ref={passwordRef}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (feedback) setFeedback(null); }}
                  onBlur={() => setTouchedPassword(true)}
                  aria-invalid={!!passwordError || feedback?.field === 'password'}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                  className={`w-full h-10 rounded-(--radius-sm) border bg-(--surface-panel) px-4 pl-10 pr-10 text-base sm:text-[13px] text-(--text-primary) placeholder:text-(--text-tertiary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-0 ${passwordError || feedback?.field === 'password' ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)'}`}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-(--text-tertiary) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /> : <Eye className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />}
                </button>
              </div>
              {passwordError && <p id="password-error" className="mt-1.5 text-[13px] text-(--status-critical-fg)">{passwordError}</p>}
            </div>

            {/* Confirm Password Field */}
            <div>
              <label htmlFor="confirmPassword" className="block text-[13px] font-medium text-(--text-primary) mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-(--text-tertiary) pointer-events-none">
                  <Lock className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <input
                  ref={confirmPasswordRef}
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => setTouchedConfirm(true)}
                  aria-invalid={!!confirmError}
                  aria-describedby={confirmError ? 'confirmPassword-error' : undefined}
                  className={`w-full h-10 rounded-(--radius-sm) border bg-(--surface-panel) px-4 pl-10 pr-10 text-base sm:text-[13px] text-(--text-primary) placeholder:text-(--text-tertiary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-0 ${confirmError ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)'}`}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-(--text-tertiary) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /> : <Eye className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />}
                </button>
              </div>
              {confirmError && <p id="confirmPassword-error" className="mt-1.5 text-[13px] text-(--status-critical-fg)">{confirmError}</p>}
            </div>

            {/* Password Requirements */}
            <PasswordRequirements password={password} />

            <AuthAlert feedback={feedback} />

            {/* Submit Button */}
            <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading} disabled={isLoading}>
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </Button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 flex justify-center">
            <Link
              to="/login"
              className="inline-flex items-center text-[13px] text-(--text-tertiary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
            >
              <ArrowLeft className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="ml-2">Back to sign in</span>
            </Link>
          </div>
    </AuthShell>
  );
}
