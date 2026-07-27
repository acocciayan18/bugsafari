import { AlertCircle, Lock, ServerCrash, ShieldAlert, Timer, WifiOff, type LucideIcon } from 'lucide-react';
import type { AuthFeedback, AuthSeverity } from '../../utils/authFeedback';

// Full class strings, never interpolated — Tailwind extracts literals only.
const TONE = {
  critical: {
    shell: 'border-(--status-critical-border) bg-(--status-critical-bg)',
    text: 'text-(--status-critical-fg)',
  },
  warning: {
    shell: 'border-(--status-warning-border) bg-(--status-warning-bg)',
    text: 'text-(--status-warning-fg)',
  },
} as const;

// One presentation per severity, shared by every auth form — icon and tone alone
// tell the operator whether the fault is theirs, ours, or the network's.
const PRESENTATION: Record<AuthSeverity, { icon: LucideIcon; tone: keyof typeof TONE }> = {
  validation: { icon: AlertCircle, tone: 'critical' },
  auth: { icon: ShieldAlert, tone: 'critical' },
  permission: { icon: Lock, tone: 'critical' },
  network: { icon: WifiOff, tone: 'warning' },
  rateLimit: { icon: Timer, tone: 'warning' },
  server: { icon: ServerCrash, tone: 'critical' },
};

interface AuthAlertProps {
  feedback: AuthFeedback | null;
}

/** Inline, single renderer for every auth failure. Errors never also toast, so one event reads once. */
export default function AuthAlert({ feedback }: AuthAlertProps) {
  if (!feedback) return null;

  const { icon: Icon, tone } = PRESENTATION[feedback.severity];
  const { shell, text } = TONE[tone];

  return (
    <div
      className={`flex items-start gap-2 rounded-(--radius-sm) border px-3 py-2 ${shell}`}
      role="alert"
      aria-live="assertive"
      data-auth-error-code={feedback.code}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${text}`} strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0">
        <p className={`text-[13px] ${text}`}>{feedback.message}</p>
        {feedback.hint && <p className={`mt-0.5 text-[13px] opacity-80 ${text}`}>{feedback.hint}</p>}
      </div>
    </div>
  );
}
