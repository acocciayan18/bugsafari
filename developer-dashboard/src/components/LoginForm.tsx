import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface LoginFormProps {
  onLoginSuccess?: (newToken: string, newUser: { id: string; email: string }) => void;
  onGuestAccess: () => void;
}

export default function LoginForm({
  onLoginSuccess,
  onGuestAccess,
}: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();
  const { login, isLoading, setNavigate: setAuthNavigate } = useAuth();

  // Set up navigate callback once on mount
  useEffect(() => {
    setAuthNavigate(navigate);
  }, [navigate, setAuthNavigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!email.trim() || !password) {
      setFormError('Email and password are required');
      return;
    }

try {
      const success = await login({ email, password });
      if (!success) {
        // Error is handled by the hook with toast
        setFormError('Login failed. Please check your credentials.');
      } else if (onLoginSuccess) {
        // Get stored token and user for callback
        const token = localStorage.getItem('bugsafari_token');
        const storedUser = localStorage.getItem('bugsafari_user');
        if (token && storedUser) {
          try {
            const user = JSON.parse(storedUser);
            onLoginSuccess(token, user);
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setFormError(errorMessage);
      console.error('[LoginForm] Login error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">BugSafari</h1>
          <p className="text-sm text-slate-600 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-slate-500 focus:outline-none"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900 focus:border-slate-500 focus:outline-none"
              placeholder="••••••••"
              required
            />
          </div>

          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
              <p className="text-sm text-rose-700">{formError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Please wait...' : 'Sign In'}
          </button>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-500">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={onGuestAccess}
            className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Skip / Continue as Guest
          </button>
        </form>

<div className="mt-6 text-center">
          <Link
            to="/signup"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Don&apos;t have an account?{' '}
            <span className="font-semibold text-slate-900">Sign up</span>
          </Link>
        </div>

        
      </div>
    </div>
  );
}
