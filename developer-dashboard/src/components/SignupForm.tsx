import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface SignupFormProps {
  onSignupSuccess?: (newToken: string, newUser: { id: string; email: string }) => void;
  onSwitchToLogin: () => void;
}

export default function SignupForm({
  onSignupSuccess,
  onSwitchToLogin,
}: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const navigate = useNavigate();
  const { signup, isLoading, setNavigate: setAuthNavigate } = useAuth();

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

    if (password !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }

try {
      const success = await signup({ email, password });
      if (!success) {
        // Error is already handled by useAuth with toast.promise
        // Set empty to let toast show the actual server error
        setFormError('');
      } else if (onSignupSuccess) {
        // Get stored token and user for callback
        const token = localStorage.getItem('bugsafari_token');
        const storedUser = localStorage.getItem('bugsafari_user');
        if (token && storedUser) {
          try {
            const user = JSON.parse(storedUser);
            onSignupSuccess(token, user);
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      console.error('[SignupForm] Signup error - network path mismatch or server unavailable:', err);
      setFormError(errorMessage);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">BugSafari</h1>
          <p className="text-sm text-slate-600 mt-1">Create an account</p>
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
              placeholder="At least 8 characters"
              required
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-1">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {isLoading ? 'Please wait...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Already have an account?{' '}
            <span className="font-semibold text-slate-900">Sign in</span>
          </button>
        </div>

        <div className="mt-8 p-4 bg-slate-50 rounded-lg">
          <h3 className="text-sm font-medium text-slate-700 mb-2">Why Create an Account?</h3>
          <ul className="text-xs text-slate-600 space-y-1">
            <li>• Save sessions to history</li>
            <li>• View and manage past explorations</li>
            <li>• Access from any device</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
