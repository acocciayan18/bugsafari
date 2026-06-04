import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface SignupFormProps {
  onSignupSuccess?: (newToken: string, newUser: { id: string; email: string }) => void;
  onSwitchToLogin: () => void;
}

// Validation rule types
interface ValidationRule {
  key: string;
  label: string;
  isValid: boolean;
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

  // Password validation states
  const [hasMinLength, setHasMinLength] = useState(false);
  const [hasUppercase, setHasUppercase] = useState(false);
  const [hasNumber, setHasNumber] = useState(false);
  const [hasSpecialChar, setHasSpecialChar] = useState(false);

  // Password strength validation: all 4 criteria must be true
  const isPasswordStrong = hasMinLength && hasUppercase && hasNumber && hasSpecialChar;

  // Validation checklist items
  const validationRules: ValidationRule[] = [
    { key: 'minLength', label: 'At least 8 characters', isValid: hasMinLength },
    { key: 'uppercase', label: 'One uppercase letter (A-Z)', isValid: hasUppercase },
    { key: 'number', label: 'One numeric character (0-9)', isValid: hasNumber },
    { key: 'specialChar', label: 'One special character (!@#$%^&*)', isValid: hasSpecialChar },
  ];

  // Validate password on every change
  useEffect(() => {
    setHasMinLength(password.length >= 8);
    setHasUppercase(/[A-Z]/.test(password));
    setHasNumber(/[0-9]/.test(password));
    setHasSpecialChar(/[^A-Za-z0-9]/.test(password));
  }, [password]);

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

    if (!isPasswordStrong) {
      setFormError('Password does not meet all requirements');
      return;
    }

    try {
      const success = await signup({ email, password });
      if (!success) {
        // Error is already handled by useAuth with toast.promise
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
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-zinc-100">BugSafari</h1>
          <p className="text-sm text-zinc-500 mt-1">Create an account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-300 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              placeholder="Enter a strong password"
              required
            />
          </div>

          {/* Dynamic Password Strength Checklist */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Password Requirements
            </p>
            <div className="grid grid-cols-2 gap-2">
              {validationRules.map((rule) => (
                <div
                  key={rule.key}
                  className={`flex items-center gap-2 text-xs transition-all duration-200 ${
                    rule.isValid ? 'text-emerald-500' : 'text-zinc-500'
                  }`}
                >
                  {rule.isValid ? (
                    <svg
                      className="w-3 h-3 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-3 h-3 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <circle cx="6" cy="10" r="2" />
                    </svg>
                  )}
                  <span className="truncate">{rule.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-300 mb-1">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              placeholder="••••••••"
              required
            />
          </div>

          {formError && (
            <div className="p-3 bg-red-950/50 border border-red-900 rounded-lg">
              <p className="text-sm text-red-400">{formError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !isPasswordStrong}
            className="w-full rounded-lg bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {isLoading ? 'Please wait...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Already have an account?{' '}
            <span className="font-semibold text-zinc-300">Sign in</span>
          </button>
        </div>

        <div className="mt-8 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-300 mb-2">Why Create an Account?</h3>
          <ul className="text-xs text-zinc-500 space-y-1">
            <li>• Save sessions to history</li>
            <li>• View and manage past explorations</li>
            <li>• Access from any device</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
