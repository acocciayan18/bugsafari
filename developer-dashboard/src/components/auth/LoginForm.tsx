import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface LoginFormProps {
  onGuestAccess?: () => void;
}

const UserIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const LockClosedIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const EyeSlashIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F8FAFC]">
      <div className="w-full max-w-[400px]">
        <div className="bg-white border border-[#DBEAFE] rounded-[12px] shadow-md px-8 py-8">
          <h1 className="text-center text-[28px] leading-tight font-semibold text-[#111827] mb-6">Bugsafari</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block font-['Inter'] text-[12px] font-medium leading-[16.8px] tracking-[0px] text-[#434655] mb-2">Username</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-[#64748B]"><UserIcon /></span>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="w-full h-11 rounded-[8px] border border-[#CBD5E1] pl-10 pr-3 text-[14px] text-[#334155] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="block font-['Inter'] text-[12px] font-medium leading-[16.8px] tracking-[0px] text-[#434655]">Password</label>
                <Link to="/forgot-password" className="text-[14px] font-semibold text-[#2563EB] hover:text-[#1D4ED8]">Forgot password?</Link>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-[#64748B]"><LockClosedIcon /></span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 rounded-[8px] border border-[#CBD5E1] pl-10 pr-10 text-[14px] text-[#334155] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
                  required
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center text-[#475569]">
                  {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-[12px] font-medium text-[#434655] pt-1">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]"
              />
              <span>Remember me for 30 days</span>
            </label>

            {formError && (
              <div className="rounded-md border border-[#EF4444]/40 bg-[#FEF2F2] px-3 py-2">
                <p className="text-sm text-[#B91C1C]">{formError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-[8px] bg-[#0052CC] text-white text-[16px] font-semibold hover:bg-[#0047B3] disabled:opacity-50"
            >
              {isLoading ? 'Please wait...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <span className="h-px bg-[#CBD5E1] flex-1" />
            <p className="text-[12px] tracking-[0.1em] text-[#334155] font-medium">OR CONTINUE WITH</p>
            <span className="h-px bg-[#CBD5E1] flex-1" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" className="h-11 rounded-[8px] border border-[#CBD5E1] bg-white text-[#111827] text-[14px] font-medium flex items-center justify-center gap-2 hover:bg-[#F8FAFC]">
              <GoogleIcon />
              <span>Google</span>
            </button>
            <button type="button" className="h-11 rounded-[8px] border border-[#CBD5E1] bg-white text-[#111827] text-[14px] font-medium flex items-center justify-center gap-2 hover:bg-[#F8FAFC]">
              <GithubIcon />
              <span>GitHub</span>
            </button>
          </div>
        </div>

        <div className="mt-8 text-center text-[14px] text-[#0F172A]">
          Don't have an account?{' '}
          <Link to="/signup" className="text-[#2563EB] font-medium hover:text-[#1D4ED8]">Sign Up</Link>
        </div>

        <div className="mt-3 text-center">
          <button type="button" onClick={handleGuestClick} className="text-sm text-[#64748B] hover:text-[#2563EB]">
            Continue As Guest
          </button>
        </div>
      </div>
    </div>
  );
}