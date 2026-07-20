// SidebarLayout - shared navigation shell for the protected routes.
// Owns the responsive navigation mode so routes never thread sidebar state.
//   lg+   : in-flow column, collapsible to a 56px rail, choice persisted
//   < lg  : off-canvas drawer over the content, opened from the mobile top bar

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import { useIsCompact } from '../../hooks/useMediaQuery';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import type { AuthUser } from '../../context/AuthContext';

type ViewType = 'dashboard' | 'history' | 'settings';

const COLLAPSE_KEY = 'bugsafari_sidebar_collapsed';

const VIEW_TITLES: Record<ViewType, string> = {
  dashboard: 'Dashboard',
  history: 'Forensic History',
  settings: 'Settings',
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface SidebarLayoutProps {
  user: AuthUser | null;
  isAuthenticated: boolean;
  activeView: ViewType;
  children: ReactNode;
  /** When set, children are wrapped in a div with this class (e.g. "flex flex-1"). */
  contentClassName?: string;
}

export default function SidebarLayout({
  user,
  isAuthenticated,
  activeView,
  children,
  contentClassName,
}: SidebarLayoutProps) {
  const isCompact = useIsCompact();
  const [isCollapsed, setIsCollapsed] = useState(readCollapsed);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        /* private mode — the preference is simply not persisted */
      }
      return next;
    });
  }, []);

  // Growing past the drawer breakpoint must not leave an orphaned overlay behind.
  useEffect(() => {
    if (!isCompact) setIsDrawerOpen(false);
  }, [isCompact]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isDrawerOpen, closeDrawer]);

  useBodyScrollLock(isDrawerOpen);

  const content = contentClassName ? <div className={contentClassName}>{children}</div> : children;

  return (
    <div className="flex h-dvh-screen w-full overflow-hidden bg-(--surface-app)">
      {!isCompact && (
        <Sidebar
          user={user}
          isLoggedIn={isAuthenticated}
          activeView={activeView}
          isCollapsed={isCollapsed}
          onToggleCollapse={toggleCollapse}
        />
      )}

      {isCompact && (
        <>
          <div
            onClick={closeDrawer}
            aria-hidden="true"
            className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
              isDrawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />
          <div
            role="dialog"
            aria-modal={isDrawerOpen || undefined}
            aria-label="Navigation menu"
            aria-hidden={!isDrawerOpen}
            inert={!isDrawerOpen}
            className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out ${
              isDrawerOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar
              user={user}
              isLoggedIn={isAuthenticated}
              activeView={activeView}
              isDrawer
              onDismiss={closeDrawer}
            />
          </div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isCompact && (
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-(--border-hairline) bg-(--surface-panel) px-3">
            <button
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={isDrawerOpen}
              className="touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="min-w-0 truncate text-sm font-bold uppercase tracking-wider text-(--text-primary)">
              {VIEW_TITLES[activeView]}
            </span>
          </header>
        )}
        {content}
      </div>
    </div>
  );
}
