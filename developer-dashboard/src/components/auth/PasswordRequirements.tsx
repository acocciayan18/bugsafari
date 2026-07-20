import { Check, X } from 'lucide-react';

// Mirrors testing-core/src/presentation/authentication/authValidation.ts PASSWORD_COMPLEXITY_PATTERNS
export function getPasswordChecks(password: string) {
  return {
    hasMinLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  };
}

export function isPasswordValid(password: string): boolean {
  const c = getPasswordChecks(password);
  return c.hasMinLength && c.hasUppercase && c.hasNumber && c.hasSymbol;
}

function RequirementRow({ met, label }: { met: boolean; label: string }) {
  return (
    <div className={`text-[13px] font-medium flex items-center gap-2 ${met ? 'text-(--status-stable-fg)' : 'text-(--status-critical-fg)'}`}>
      {met ? <Check className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : <X className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
      <span className="min-w-0">{label}</span>
    </div>
  );
}

interface PasswordRequirementsProps {
  password: string;
}

/** Shown only once the user starts typing a password; live-updates as they type. */
export default function PasswordRequirements({ password }: PasswordRequirementsProps) {
  if (!password) return null;
  const c = getPasswordChecks(password);
  return (
    <div
  className="rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-inset) p-3 sm:p-4"
  role="status"
  aria-live="polite"
>
  <p className="mb-2 sm:mb-3 text-[13px] font-mono font-medium tracking-[0.08em] text-(--text-primary)">
    SECURITY REQUIREMENTS
  </p>

  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
    <RequirementRow met={c.hasMinLength} label="At least 8 characters long" />
    <RequirementRow met={c.hasUppercase} label="Include 1 uppercase letter" />
    <RequirementRow met={c.hasNumber} label="Include at least one number" />
    <RequirementRow met={c.hasSymbol} label="Include 1 special character" />
  </div>
</div>
  );
}
