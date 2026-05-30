import { useState, type FormEvent } from 'react';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

interface LoginFormProps {
  onLoginSuccess: (token: string, user: { id: string; email: string }) => void;
  onSwitchToSignup: () => void;
  onGuestAccess: () => void;
}

interface AuthError {
  error: string;
}

interface AuthResponse {
  ok?: boolean;
  token: string;
  user: {
    id: string;
    email: string;
  };
  error?: string;
}

export default function LoginForm({
  onLoginSuccess,
  onSwitchToSignup,
  onGuestAccess,
}: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!email.trim() || !password) {
      setError('Email and password are required');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data: AuthResponse | AuthError = await response.json();

      if (!response.ok) {
        setError((data as AuthError).error ?? 'Login failed');
        setIsLoading(false);
        return;
      }

      const authData = data as AuthResponse;
      if (authData.token && authData.user) {
        localStorage.setItem('bugsafari_token', authData.token);
        localStorage.setItem('bugsafari_user', JSON.stringify(authData.user));
        onLoginSuccess(authData.token, authData.user);
      }
    } catch {
      setError('Unable to connect to server');
    } finally {
      setIsLoading(false);
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

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
              <p className="text-sm text-rose-700">{error}</p>
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
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Don&apos;t have an account?{' '}
            <span className="font-semibold text-slate-900">Sign up</span>
          </button>
        </div>

        <div className="mt-8 p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-medium text-slate-700 mb-2">Guest Access</h3>
          <ul className="text-xs text-slate-600 space-y-1">
            <li>• Run exploratory tests immediately</li>
            <li>• View real-time telemetry</li>
            <li>• Access forensic reports</li>
          </ul>
          <div className="mt-2 pt-2 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              <span className="font-medium">Sign in</span> to save sessions and view history
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
