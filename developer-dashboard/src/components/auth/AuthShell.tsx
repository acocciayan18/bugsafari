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

/** HUD-bracketed console frame shared by all auth screens — corner reticle + live status strip. */
export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  maxWidth = 'max-w-[400px]',
  children,
  footer,
}: AuthShellProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh-screen flex items-center justify-center p-3 sm:p-4 lg:p-6 bg-(--surface-app)">
      <button
        type="button"
        onClick={() => navigate('/')}
        aria-label="Back to home"
        className="fixed top-3 left-3 sm:top-4 sm:left-4 lg:top-6 lg:left-6 flex items-center gap-1.5 px-3 py-2 rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-panel) text-(--text-tertiary) hover:text-(--text-primary) hover:bg-(--surface-app) transition-colors text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
      >
        <Home className="w-4 h-4 shrink-0" strokeWidth={1.75} />
        Home
      </button>
      <div className={`w-full ${maxWidth}`}>
        <div className="relative">
          {/* Corner reticle — signature HUD frame */}
         
          <div className="bg-(--surface-panel) border border-(--border-hairline) rounded-(--radius-lg) shadow-(--shadow-sm)">
           

            <div className="p-4 sm:p-6">
              <p className="text-center text-[13px] font-mono font-medium tracking-[0.14em] text-(--text-tertiary) mb-2">{eyebrow}</p>
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
