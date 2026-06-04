import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { mapNetworkError, showErrorToast } from '../infrastructure/notifications/toastUtils';
import { toast } from 'sonner';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

interface SignupFormProps {
  onSignupSuccess?: (newToken: string, newUser: { id: string; email: string }) => void;
}

// Validation rule types
interface ValidationRule {
  key: string;
  label: string;
  isValid: boolean;
}

// Auth response types matching API
interface AuthResponse {
  ok?: boolean;
  token: string;
  user: { id: string; email: string };
  error?: string;
}

export default function SignupForm({
  onSignupSuccess,
}: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

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

  // Clear email error when user starts typing
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (emailError) {
      setEmailError('');
    }
  };

// Handle signup with in-button loading spinner per requirements
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Client-side validation
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

    setIsLoading(true);

    try {
      // Direct API call without toast.promise wrapper
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
        }),
      });

      // Check content type to handle non-JSON responses
      const contentType = response.headers.get('content-type');
      let data: AuthResponse;
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        // Server returned non-JSON (likely HTML error page)
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      // Handle HTTP status codes per requirements
      if (response.status === 201) {
        // Success - account created
        if (data.token && data.user) {
          localStorage.setItem('bugsafari_token', data.token);
          localStorage.setItem('bugsafari_user', JSON.stringify(data.user));
          console.log("✔ [SIGNUP SUCCESS]: Account successfully provisioned in the container database cluster.");
          
          // Trigger toast ONLY on success
          toast.success("Account created successfully! Redirecting to login terminal...");
          
          // Immediate redirect to /login after success
          navigate('/login', { replace: true });

          // Invoke callback if provided
          if (onSignupSuccess) {
            onSignupSuccess(data.token, data.user);
          }
          
          setIsLoading(false);
          return;
        }
        throw new Error('Invalid server response');
      }

      if (response.status === 409) {
        // Conflict - email already exists
        const errorMsg = data.error ?? 'This email identifier already holds active credentials.';
        setEmailError(errorMsg);
        throw new Error(`Registration Rejected: ${errorMsg}`);
      }

      // Other errors
      const errorMsg = data.error ?? `Registration failed: ${response.status}`;
      throw new Error(errorMsg);
    } catch (err) {
      // Handle errors with proper message mapping
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      
      // Map network errors to high-visibility message
      const networkMessage = mapNetworkError(errorMessage);
      if (networkMessage.includes('Infrastructure Offline')) {
        showErrorToast(networkMessage, 8000);
      }
      
      // Don't overwrite emailError if it's a conflict (409)
      if (!emailError) {
        setFormError(errorMessage);
      }
      
      console.error('[SignupForm] Signup error:', err);
    } finally {
      setIsLoading(false);
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
              onChange={handleEmailChange}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              placeholder="you@example.com"
              required
            />
            {emailError && (
              <p className="text-rose-500 text-xs mt-1">Registration Rejected: {emailError}</p>
            )}
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
                      className="w-3 h-3 shrink-0"
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
                      className="w-3 h-3 shrink-0"
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
            className="w-full rounded-lg bg-zinc-100 px-4 cursor-pointer py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Creating Account...</span>
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

<div className="mt-6 text-center">
          <Link
            to="/login"
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Already have an account?{' '}
            <span className="font-semibold text-zinc-300">Sign in</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
