import type { ReactNode } from 'react';

type StatusTone = 'idle' | 'busy' | 'error' | 'success';



interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
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
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-(--surface-app)">
      <div className={`w-full ${maxWidth}`}>
        <div className="relative">
          {/* Corner reticle — signature HUD frame */}
         
          <div className="bg-(--surface-panel) border border-(--border-hairline) rounded-(--radius-lg) shadow-(--shadow-sm)">
           

            <div className="p-6">
              <p className="text-center text-[13px] font-mono font-medium tracking-[0.14em] text-(--text-tertiary) mb-2">{eyebrow}</p>
              <h1 className="text-center text-h2 leading-tight font-semibold text-(--text-primary) mb-2">{title}</h1>
              {subtitle && <p className="text-center text-body-sm text-(--text-primary) mb-6">{subtitle}</p>}

              {children}
            </div>
          </div>
        </div>

        {footer}
      </div>
    </div>
  );
}
