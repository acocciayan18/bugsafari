import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LockClosedIcon, EyeIcon, EyeSlashIcon, WarningIcon } from '../icons';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

const EnvelopeIcon = () => (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v11.25a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const GoogleIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.233 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 19.002 13 24 13c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4c-7.682 0-14.347 4.337-17.694 10.691z" />
    <path fill="#4CAF50" d="M24 44c5.176 0 9.944-1.977 13.545-5.197l-6.26-5.298C29.268 35.091 26.761 36 24 36c-5.211 0-9.617-3.316-11.283-7.946l-6.522 5.024C9.509 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 01-4.018 5.505l.003-.002 6.26 5.298C37.102 39.2 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

interface RequirementRowProps {
  met: boolean;
  label: string;
}

function RequirementRow({ met, label }: RequirementRowProps) {
  return (
    <div className={`text-xs font-medium flex items-center gap-2 ${met ? 'text-green-600' : 'text-red-500'}`}>
      {met ? <CheckIcon /> : <WarningIcon className="w-4 h-4" />}
      <span>{label}</span>
    </div>
  );
}

export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigate = useNavigate();
  const { signup, isLoading, setNavigate: setAuthNavigate } = useAuth();

  useEffect(() => {
    setAuthNavigate(navigate);
  }, [navigate, setAuthNavigate]);

  const hasMinLength = password.length >= 8;
  const hasSymbol = /[_!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!email.trim() || !email.includes('@')) return setFormError('Please enter a valid email address.');
    if (!password || password.length < 8) return setFormError('Password must be at least 8 characters.');
    if (!hasSymbol || !hasNumber) return setFormError('Password must include symbols and numbers.');
    if (password !== confirmPassword) return setFormError('Passwords do not match.');

    try {
      const success = await signup({ email: email.trim(), password });
      if (!success) setFormError('Registration failed. Please try again.');
    } catch (err) {
      console.error('[SignupForm] Signup error:', err);
      setFormError('Unable to connect to server. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-nova-light dark:bg-nova-dark">
      <div className="w-full max-w-[420px]">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md p-6">
          <h1 className="text-center text-h2 font-semibold text-gray-900 dark:text-gray-100 mb-2">Create Account</h1>
          <p className="text-center text-body-sm text-gray-600 dark:text-gray-400 mb-7">Start hunting bugs with BugSafari today.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-gray-400 pointer-events-none"><EnvelopeIcon /></span>
              <Input
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@company.com"
                className="pl-10"
                required
              />
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-gray-400 pointer-events-none"><LockClosedIcon className="w-[18px] h-[18px]" /></span>
              <Input
                id="password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue rounded-md"
              >
                {showPassword ? <EyeSlashIcon className="w-[18px] h-[18px]" /> : <EyeIcon className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <div className="relative">
              <span className="absolute left-3 top-[38px] text-gray-400 pointer-events-none"><LockClosedIcon className="w-[18px] h-[18px]" /></span>
              <Input
                id="confirmPassword"
                label="Confirm Password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-[26px] flex h-10 w-10 items-center justify-center text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue rounded-md"
              >
                {showConfirmPassword ? <EyeSlashIcon className="w-[18px] h-[18px]" /> : <EyeIcon className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <div className="rounded-md border border-blue-100 bg-blue-50 p-4 dark:bg-blue-950/20 dark:border-blue-900">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Security requirements:</p>
              <div className="space-y-1.5">
                <RequirementRow met={hasMinLength} label="At least 8 characters long" />
                <RequirementRow met={hasSymbol} label="Include 1 special character (@, #, $)" />
                <RequirementRow met={hasNumber} label="Include at least one number" />
              </div>
            </div>

            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:bg-red-950/40 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-400">{formError}</p>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              isLoading={isLoading}
              disabled={!email || !password || !confirmPassword || !hasMinLength || !hasSymbol || !hasNumber || password !== confirmPassword}
            >
              {isLoading ? 'Creating account...' : 'Create Account'}
            </Button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-sm text-gray-500">OR</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <Button type="button" variant="secondary" size="md" className="w-full !border-gray-300 !text-gray-900 dark:!text-gray-100">
              <GoogleIcon />
              <span>Sign up with Google</span>
            </Button>
          </form>
        </div>
        <div className="mt-5 text-center text-sm text-gray-600 dark:text-gray-400">
          Already have an account? <Link to="/login" className="text-nova-blue font-medium hover:text-blue-700">Log in</Link>
        </div>
      </div>
    </div>
  );
}
