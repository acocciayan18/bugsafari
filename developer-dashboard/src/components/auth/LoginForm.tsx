import { useEffect, useState, useRef, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserIcon, LockClosedIcon, EyeIcon, EyeSlashIcon } from '../icons';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';

interface LoginFormProps {
  onGuestAccess?: () => void;
}

const GoogleIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24">
    <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.2-1.4 3.6-5.4 3.6-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.6 3.3 14.5 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6s4.1 9.2 9.2 9.2c5.3 0 8.9-3.7 8.9-8.9 0-.6-.1-1.1-.2-1.7H12z" />
  </svg>
);

const GithubIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .5C5.7.5.8 5.4.8 11.7c0 5 3.2 9.3 7.6 10.8.6.1.8-.3.8-.6v-2.2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1 1.9.9 2.3 1.5.3-.8.8-1.3 1.4-1.6-2.5-.3-5.2-1.2-5.2-5.5 0-1.2.4-2.2 1.1-3-.1-.3-.5-1.4.1-3 0 0 .9-.3 3 .1a10 10 0 015.5 0c2.1-.4 3-.1 3-.1.6 1.6.2 2.7.1 3 .7.8 1.1 1.8 1.1 3 0 4.3-2.6 5.2-5.2 5.5.4.3.8 1 .8 2v3c0 .3.2.7.8.6 4.4-1.5 7.6-5.8 7.6-10.8C23.2 5.4 18.3.5 12 .5z" />
  </svg>
);

export default function LoginForm({ onGuestAccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const { login, isLoading, authError, clearAuthError, setNavigate: setAuthNavigate } = useAuth();

  useEffect(() => {
    setAuthNavigate(navigate);
  }, [navigate, setAuthNavigate]);

  const handleGuestClick = () => {
    if (onGuestAccess) onGuestAccess();
    navigate('/dashboard');
  };

  const emailError = (touchedEmail || submitted) && !email.trim() ? 'Email is required.' : '';
  const passwordError = (touchedPassword || submitted) && !password ? 'Password is required.' : '';

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
            <button type="button" onClick={handleGuestClick} className="text-sm text-(--text-tertiary) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)] px-1">
              Continue As Guest
            </button>
          </div>
        </>
      }
    >
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-(--text-tertiary) pointer-events-none"><UserIcon className="w-4 h-4" /></span>
              <Input
                ref={emailRef}
                id="email"
                label="Email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouchedEmail(true)}
                placeholder="example@email.com"
                className="pl-10 "
                error={emailError || undefined}
                required
              />
            </div>

            <div className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="text-sm font-medium text-(--text-primary)">Password</label>
                <Link to="/forgot-password" className="text-sm font-normal text-(--text-tertiary) hover:text-(--text-primary)">Forgot password?</Link>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-(--text-tertiary) pointer-events-none"><LockClosedIcon className="w-4 h-4" /></span>
                <input
                  ref={passwordRef}
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouchedPassword(true)}
                  placeholder="••••••••"
                  aria-invalid={!!passwordError}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                  className={`w-full h-10 rounded-[var(--radius-sm)] border bg-[var(--surface-panel)] pl-10 pr-10 text-base text-(--text-primary) placeholder:text-(--text-tertiary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-0 ${passwordError ? 'border-[var(--status-critical-fg)]' : 'border-[var(--border-hairline)]'}`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-(--text-tertiary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
                >
                  {showPassword ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
              {passwordError && <p id="password-error" className="mt-1.5 text-xs text-[var(--status-critical-fg)]">{passwordError}</p>}
            </div>

           

            {authError && (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--status-critical-fg)]" strokeWidth={1.75} aria-hidden="true" />
                <p className="text-sm text-[var(--status-critical-fg)]" role="alert">{authError}</p>
              </div>
            )}

            <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading} disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>



    </AuthShell>
  );
}
