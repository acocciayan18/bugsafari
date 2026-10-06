import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Soft elevated card frame shared by all auth screens — accent eyebrow over an exploration-graph backdrop. */
export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  maxWidth = 'max-w-[480px]',
  children,
  footer,
}: AuthShellProps) {
  const navigate = useNavigate();

  return (
    <div className="relative isolate overflow-hidden min-h-dvh-screen flex items-center justify-center p-3 sm:p-4 lg:p-6 bg-(--surface-app)">
      {/* Exploration-graph backdrop (.auth-backdrop): CSS node-grid + signal bloom + scan-sweep,
          token-driven for light/dark, masked and low-opacity so the form stays fully readable. */}
      <div aria-hidden="true" className="auth-backdrop" />
      <div className={`w-full ${maxWidth}`}>
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Back to home"
          className="mb-3 -ml-1 inline-flex items-center gap-1.5 rounded-(--radius-md) px-2 py-1.5 text-(--text-tertiary) hover:text-(--text-primary) cursor-pointer transition-colors text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
        >
          <Home className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          Home
        </button>
        <div className="relative">
          {/* Corner reticle — signature HUD frame */}
         
          <div className="bg-(--surface-panel) border border-(--border-hairline) rounded-(--radius-xl) shadow-(--shadow-lg)">
            <div className="p-4 sm:p-6">
              <p className="text-center text-[13px] font-mono font-semibold tracking-[0.14em] text-(--accent-soft-fg) mb-2">{eyebrow}</p>
              <h1 className="text-center text-h2 leading-tight font-semibold text-(--text-primary) mb-2">{title}</h1>
              {subtitle && <p className="text-center text-body-sm text-(--text-primary) mb-5 sm:mb-6">{subtitle}</p>}

              {children}
            </div>
          </div>
        </div>

        {footer}
      </div>
    </div>
  );
}
