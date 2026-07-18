import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { UserIcon, LockClosedIcon, EyeIcon, EyeSlashIcon } from '../icons';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();
  const { login, isLoading, setNavigate: setAuthNavigate } = useAuth();

  useEffect(() => {
    setAuthNavigate(navigate);
  }, [navigate, setAuthNavigate]);

  const handleGuestClick = () => {
    if (onGuestAccess) onGuestAccess();
    navigate('/dashboard');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!username.trim() || !password) {
      setFormError('Username and password are required');
      return;
    }
    try {
      const success = await login({ email: username.trim(), password });
      if (!success) setFormError('Login failed. Please check your credentials.');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setFormError(errorMessage);
      console.error('[LoginForm] Login error:', err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--surface-app)]">
      <div className="w-full max-w-[400px]">
        <div className="bg-[var(--surface-panel)] border border-[var(--border-hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] p-6">
          <p className="text-center text-xs font-mono font-medium tracking-[0.14em] text-[var(--text-tertiary)] mb-2">TERMINAL ACCESS</p>
          <h1 className="text-center text-h2 leading-tight font-semibold text-[var(--text-primary)] mb-6">Bugsafari</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-[var(--text-tertiary)] pointer-events-none"><UserIcon className="w-4 h-4" /></span>
              <Input
                id="username"
                label="Username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="pl-10 "
                required
              />
            </div>

            <div className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="text-sm font-medium text-[var(--text-secondary)]">Password</label>
                <Link to="/forgot-password" className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Forgot password?</Link>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-[var(--text-tertiary)] pointer-events-none"><LockClosedIcon className="w-4 h-4" /></span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-panel)] pl-10 pr-10 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)]"
                >
                  {showPassword ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] pt-1">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded-[var(--radius-sm)] border-[var(--border-strong)] text-[var(--text-primary)] focus:ring-[var(--border-focus)]"
              />
              <span>Remember me for 30 days</span>
            </label>

            {formError && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-3 py-2">
                <p className="text-sm text-[var(--status-critical-fg)]">{formError}</p>
              </div>
            )}

            <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading}>
              {isLoading ? 'Please wait...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <span className="h-px bg-[var(--border-hairline)] flex-1" />
            <p className="text-xs font-mono tracking-[0.14em] text-[var(--text-tertiary)] font-medium">OR CONTINUE WITH</p>
            <span className="h-px bg-[var(--border-hairline)] flex-1" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button type="button" variant="secondary" size="md" className="!text-[var(--text-primary)]">
              <GoogleIcon />
              <span>Google</span>
            </Button>
            <Button type="button" variant="secondary" size="md" className="!text-[var(--text-primary)]">
              <GithubIcon />
              <span>GitHub</span>
            </Button>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-[var(--text-secondary)]">
          Don't have an account?{' '}
          <Link to="/signup" className="text-[var(--text-primary)] font-medium hover:underline underline-offset-2">Sign Up</Link>
        </div>

        <div className="mt-3 text-center">
          <button type="button" onClick={handleGuestClick} className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] rounded-[var(--radius-sm)] px-1">
            Continue As Guest
          </button>
        </div>
      </div>
    </div>
  );
}
