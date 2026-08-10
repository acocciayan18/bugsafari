import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleX, Loader2, MailCheck } from 'lucide-react';
import { AUTH_SUCCESS, authSuccessToast } from '../../infrastructure/notifications/authToasts';
import { postAuth, type AuthFeedback } from '../../utils/authFeedback';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import AuthShell from './AuthShell';
import AuthAlert from './AuthAlert';
import type { AuthUser } from '../../context/AuthContext';

interface VerifyResponse {
  ok?: boolean;
  alreadyVerified?: boolean;
  token?: string;
  user?: AuthUser;
}

type Status = 'verifying' | 'error' | 'done';

export default function VerifyEmailForm() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const establishSession = useAuthStore((s) => s.establishSession);
  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';

  const [status, setStatus] = useState<Status>('verifying');
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
  const [resending, setResending] = useState(false);
  // StrictMode double-mounts effects in dev; guard so the single-use token isn't
  // consumed by the first mount and then rejected on the second.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token || !email) {
      setStatus('error');
      return;
    }

    (async () => {
      const result = await postAuth<VerifyResponse>('/api/auth/verify-email', { email, token });

      if (!result.ok) {
        setFeedback(result.feedback);
        setStatus('error');
        return;
      }

      // Link opened after the account was already verified — nothing to do but
      // send them to sign in.
      if (result.data.alreadyVerified) {
        setStatus('done');
        navigate('/login');
        return;
      }

      const { token: accessToken, user } = result.data;
      if (!accessToken || !user) {
        setStatus('error');
        return;
      }

      establishSession(accessToken, user);
      authSuccessToast(AUTH_SUCCESS.emailVerified);
      setStatus('done');
      navigate('/dashboard');
    })();
  }, [token, email, establishSession, navigate]);

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    const result = await postAuth('/api/auth/resend-verification', { email });
    setResending(false);
    // Only claim success once the backend confirms the email actually sent.
    if (result.ok) authSuccessToast(AUTH_SUCCESS.verificationResent);
    else setFeedback(result.feedback);
  };

  if (status === 'verifying' || status === 'done') {
    return (
      <AuthShell eyebrow="EMAIL VERIFICATION" title="Verifying your email">
        <div className="text-center">
          <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 bg-(--surface-panel) border border-(--border-hairline) rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-(--text-secondary)"><Loader2 className="w-7 h-7 sm:w-8 sm:h-8 animate-spin" strokeWidth={1.75} aria-hidden="true" /></span>
          </div>
          <p className="text-(--text-primary)">Confirming your account…</p>
        </div>
      </AuthShell>
    );
  }

  // status === 'error'
  return (
    <AuthShell eyebrow="VERIFICATION FAILED" title="Link invalid or expired">
      <div className="text-center">
        <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 bg-(--status-critical-bg) border border-(--status-critical-border) rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-(--status-critical-fg)"><CircleX className="w-7 h-7 sm:w-8 sm:h-8" strokeWidth={1.75} aria-hidden="true" /></span>
        </div>
        <p className="text-(--text-primary) mb-5 sm:mb-6">
          This verification link is invalid or has expired.
        </p>

        <AuthAlert feedback={feedback} />

        {email && (
          <Button variant="primary" size="md" className="w-full" isLoading={resending} disabled={resending} onClick={handleResend}>
            <span className="inline-flex items-center gap-2">
              <MailCheck className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {resending ? 'Sending…' : 'Resend verification email'}
            </span>
          </Button>
        )}

        <div className="mt-6 flex justify-center">
          <Link
            to="/login"
            className="inline-flex items-center text-[13px] text-(--text-tertiary) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
          >
            <ArrowLeft className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="ml-2">Back to sign in</span>
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
