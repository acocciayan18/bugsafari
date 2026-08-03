import { useEffect, useState, useRef, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Lock, Eye, EyeOff, MailCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AUTH_SUCCESS, authSuccessToast, authEventToast } from '../../infrastructure/notifications/authToasts';
import { postAuth } from '../../utils/authFeedback';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';
import AuthAlert from './AuthAlert';
import GuestModeModal from './GuestModeModal';
import LegalFooter from '../legal/LegalFooter';
import LegalDocModal from '../legal/LegalDocModal';
import type { LegalDocId } from '../../legal/content';

interface LoginFormProps {
  onGuestAccess?: () => void;
}



export default function LoginForm({ onGuestAccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false);
  const [openDocId, setOpenDocId] = useState<LegalDocId | null>(null);
  const [resending, setResending] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const { login, continueAsGuest, isLoading, authError, clearAuthError, setNavigate: setAuthNavigate } = useAuth();

  useEffect(() => {
    setAuthNavigate(navigate);
  }, [navigate, setAuthNavigate]);

  // authError is one shared store field, so a failure left behind by /signup would
  // still be mounted here. Each auth screen starts from a clean slate.
  useEffect(() => {
    clearAuthError();
  }, [clearAuthError]);

  // Guest mode must be enabled through the context (React state + storage flag)
  // before navigating — navigating alone leaves the guards seeing a dead session.
  const confirmGuestAccess = () => {
    setIsGuestModalOpen(false);
    continueAsGuest();
    if (onGuestAccess) onGuestAccess();
    navigate('/dashboard');
  };

  const emailError = (touchedEmail || submitted) && !email.trim() ? 'Email is required.' : '';
  const passwordError = (touchedPassword || submitted) && !password ? 'Password is required.' : '';

  // Wrong credentials are not attributable to one field, so both are marked —
  // and the wording lives once, in the alert.
  const credentialsRejected = authError?.code === 'INVALID_CREDENTIALS';
  const emailUnverified = authError?.code === 'EMAIL_UNVERIFIED';

  const handleResendVerification = async () => {
    if (!email.trim()) return;
    setResending(true);
    const result = await postAuth('/api/auth/resend-verification', { email: email.trim() });
    setResending(false);
    // Only claim success once the backend confirms the email actually sent.
    if (result.ok) authSuccessToast(AUTH_SUCCESS.verificationResent);
    else authEventToast(result.feedback);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    clearAuthError();

    if (!email.trim()) {
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      passwordRef.current?.focus();
      return;
    }

    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      console.error('[LoginForm] Login error:', err);
    }
  };

  return (
    <AuthShell
      eyebrow="TERMINAL ACCESS"
      title="Bugsafari"

      footer={
        <>
          <div className="mt-8 text-center text-sm text-(--text-primary)">
            Don't have an account?{' '}
            <Link to="/signup" className="text-(--text-primary) font-medium hover:underline underline-offset-2">Sign Up</Link>
          </div>

          <div className="mt-3 text-center">
            <button type="button" onClick={() => setIsGuestModalOpen(true)} className="text-sm text-(--text-tertiary) cursor-pointer hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm) px-1">
              Continue As Guest
            </button>
          </div>

          <LegalFooter onOpenDoc={setOpenDocId} />

          <GuestModeModal
            isOpen={isGuestModalOpen}
            onClose={() => setIsGuestModalOpen(false)}
            onContinue={confirmGuestAccess}
            onCreateAccount={() => { setIsGuestModalOpen(false); navigate('/signup'); }}
          />
          <LegalDocModal docId={openDocId} onClose={() => setOpenDocId(null)} />
        </>
      }
    >
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><User className="w-4 h-4 shrink-0" /></span>
              <Input
                ref={emailRef}
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (authError) clearAuthError(); }}
                onBlur={() => setTouchedEmail(true)}
                placeholder="example@email.com"
                className="pl-10 w-full h-10 rounded-(--radius-sm) border bg-(--surface-panel) pl-10 pr-10 text-base  text-(--text-primary) placeholder:text-(--text-tertiary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-0"
                error={emailError || undefined}
                invalid={credentialsRejected || authError?.field === 'email'}
                required
              />
            </div>

            <div className="relative">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1.5">
                <label htmlFor="password" className="text-sm font-medium text-(--text-primary)">Password</label>
                <Link to="/forgot-password" className="text-sm font-normal text-(--text-tertiary) hover:text-(--text-primary)">Forgot password?</Link>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-(--text-tertiary) pointer-events-none"><Lock className="w-4 h-4 shrink-0" /></span>
                <input
                  ref={passwordRef}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (authError) clearAuthError(); }}
                  onBlur={() => setTouchedPassword(true)}
                  placeholder="••••••••"
                  aria-invalid={!!passwordError || credentialsRejected || authError?.field === 'password'}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                  className={`w-full h-10 rounded-(--radius-sm) border bg-(--surface-panel) pl-10 pr-10 text-base text-(--text-primary) placeholder:text-(--text-tertiary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-0 ${passwordError || credentialsRejected || authError?.field === 'password' ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)'}`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-(--text-tertiary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) rounded-(--radius-sm)"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {passwordError && <p id="password-error" className="mt-1.5 text-sm text-(--status-critical-fg)">{passwordError}</p>}
            </div>

           

            <AuthAlert feedback={authError} />

            {emailUnverified && (
              <Button type="button" variant="secondary" size="md" className="w-full" isLoading={resending} disabled={resending} onClick={handleResendVerification}>
                <span className="inline-flex items-center gap-2">
                  <MailCheck className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  {resending ? 'Sending…' : 'Resend verification email'}
                </span>
              </Button>
            )}

            <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading} disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>



    </AuthShell>
  );
}
