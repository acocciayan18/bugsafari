import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

// Icons
const MailIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const ArrowLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

interface ForgotPasswordResponse {
  ok?: boolean;
  message?: string;
  error?: string;
}

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data: ForgotPasswordResponse = await response.json();

      if (response.ok && data.ok) {
        setEmailSent(true);
        toast.success('Password reset link sent! Check server console for the reset link.');
      } else {
        const errorMessage = data.error ?? 'Failed to send reset link';
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      toast.error(errorMessage);
      console.error('[ForgotPassword] Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Show success message after email is sent
  if (emailSent) {
    return (
      <div className="min-h-screen bg-nova-light dark:bg-nova-dark flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-950/60 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-h4 font-bold text-gray-900 dark:text-gray-100 mb-2">Check Your Inbox</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              If an account exists with that email, a password reset link has been sent.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              In development, check the server console for the reset link.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-nova-blue transition-colors duration-200 ease-in-out"
            >
              <ArrowLeftIcon />
              <span className="ml-2">Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-nova-light dark:bg-nova-dark flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h2 className="text-h4 font-bold tracking-tight text-gray-900 dark:text-gray-100 text-center mb-2">Forgot Password?</h2>
          <p className="text-base text-gray-600 dark:text-gray-400 text-center mb-6">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div className="relative">
              <span className="absolute left-3 top-[38px] text-gray-400 pointer-events-none">
                <MailIcon />
              </span>
              <Input
                id="email"
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                placeholder="you@example.com"
                required
              />
            </div>

            {/* Submit Button */}
            <Button type="submit" variant="primary" size="md" className="w-full" isLoading={isLoading}>
              {isLoading ? 'Sending...' : 'Send Reset Link'}
            </Button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 flex justify-center">
            <Link
              to="/login"
              className="inline-flex items-center text-sm text-gray-500 hover:text-nova-blue transition-colors duration-200 ease-in-out"
            >
              <ArrowLeftIcon />
              <span className="ml-2">Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
