import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const EnvelopeIcon = () => (
  <svg className="w-[1.125rem] h-[1.125rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v11.25a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75" />
  </svg>
);

const LockClosedIcon = () => (
  <svg className="w-[1.125rem] h-[1.125rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-[1.125rem] h-[1.125rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const EyeSlashIcon = () => (
  <svg className="w-[1.125rem] h-[1.125rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

const WarningIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
    <circle cx="12" cy="12" r="8.25" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.7v4.2" />
    <circle cx="12" cy="15.75" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const GoogleIcon = () => (
  <svg className="w-[1.125rem] h-[1.125rem]" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.233 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 19.002 13 24 13c3.059 0 5.842 1.153 7.958 3.042l5.657-5.657C34.233 6.053 29.366 4 24 4c-7.682 0-14.347 4.337-17.694 10.691z" />
    <path fill="#4CAF50" d="M24 44c5.176 0 9.944-1.977 13.545-5.197l-6.26-5.298C29.268 35.091 26.761 36 24 36c-5.211 0-9.617-3.316-11.283-7.946l-6.522 5.024C9.509 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 01-4.018 5.505l.003-.002 6.26 5.298C37.102 39.2 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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

    try {
      const success = await signup({ email: email.trim(), password });
      if (!success) setFormError('Registration failed. Please try again.');
    } catch (err) {
      console.error('[SignupForm] Signup error:', err);
      setFormError('Unable to connect to server. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F8FAFC]">
      <div className="w-full max-w-[420px]">
        <div className="bg-white border border-[#E5E7EB] rounded-[1rem] shadow-[0_8px_24px_rgba(15,23,42,0.08)] px-8 py-8">
          <h1 className="text-center text-[28px] leading-tight font-semibold text-[#191B23] mb-2">Create Account</h1>
          <p className="text-center text-[15px] font-normal text-[#434655] mb-7">Start hunting bugs with BugSafari today.</p>

          <form onSubmit={handleSubmit}>
            <div className="mb-5">
              <label htmlFor="email" className="block text-[12px] font-medium text-[#434655] mb-[0.375rem]">Work Email</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-[#9CA3AF]"><EnvelopeIcon /></span>
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@company.com" className="w-full h-[2.875rem] rounded-[0.5rem] border border-[#D1D5DB] pl-10 pr-3 text-[0.875rem] text-[#1F2937] placeholder:text-[#C4B5FD] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20" required />
              </div>
            </div>

            <div className="mb-5">
              <label htmlFor="password" className="block text-[12px] font-medium text-[#434655] mb-[0.375rem]">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-[#9CA3AF]"><LockClosedIcon /></span>
                <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full h-[2.875rem] rounded-[0.5rem] border border-[#D1D5DB] pl-10 pr-10 text-[0.875rem] text-[#1F2937] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20" required />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center text-[#9CA3AF]">{showPassword ? <EyeSlashIcon /> : <EyeIcon />}</button>
              </div>
            </div>

            <div className="rounded-[0.5rem] border border-[#E0E7FF] bg-[#EEF2FF] p-4 mb-0">
              <p className="text-[12px] font-medium text-[#434655] mb-2">Security requirements:</p>
              <div className="space-y-[0.375rem]">
                <div className="text-[12px] font-medium flex items-center gap-2 text-[#EF4444]"><WarningIcon /><span>At least 8 characters long</span></div>
                <div className="text-[12px] font-medium flex items-center gap-2 text-[#EF4444]"><WarningIcon /><span>Include 1 special character (@, #, $)</span></div>
                <div className="text-[12px] font-medium flex items-center gap-2 text-[#EF4444]"><WarningIcon /><span>Include at least one number</span></div>
              </div>
            </div>

            {formError && <div className="rounded-[0.5rem] border border-[#EF4444]/40 bg-[#FEF2F2] px-3 py-2 mt-4"><p className="text-sm text-[#B91C1C]">{formError}</p></div>}

            <div className="mt-5">
              <button type="submit" disabled={isLoading || !email || !password || !hasMinLength || !hasSymbol || !hasNumber} className="w-full h-11 rounded-[0.5rem] bg-[#0052CC] text-white text-[15px] font-medium hover:bg-[#0047B3] disabled:opacity-50">
                {isLoading ? 'Creating account...' : 'Create Account'}
              </button>

              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-[#E5E7EB]" />
                <span className="text-[0.875rem] text-[#6B7280]">OR</span>
                <div className="h-px flex-1 bg-[#E5E7EB]" />
              </div>

              <button type="button" className="w-full h-11 rounded-[0.5rem] border border-[#D1D5DB] bg-white text-[#191B23] text-[15px] font-medium flex items-center justify-center gap-2.5">
                <GoogleIcon />
                <span>Sign up with Google</span>
              </button>
            </div>
          </form>

        </div>
        <div className="mt-5 text-center text-[15px] font-normal text-[#434655]">
          Already have an account? <Link to="/login" className="text-[#004AC6] hover:text-[#003EA5]">Log in</Link>
        </div>
      </div>
    </div>
  );
}
