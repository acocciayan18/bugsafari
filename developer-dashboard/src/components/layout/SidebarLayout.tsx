// SidebarLayout - shared sidebar + content shell for the protected routes.
// Eliminates the 4x duplicated <Sidebar/> + container block in App.tsx.

import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import type { AuthUser } from '../../context/AuthContext';

type ViewType = 'dashboard' | 'history' | 'settings';

interface SidebarLayoutProps {
  user: AuthUser | null;
  isAuthenticated: boolean;
  activeView: ViewType;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  children: ReactNode;
  /** Outer flex shell. Defaults to the standard route container. */
  outerClassName?: string;
  /** When set, children are wrapped in a div with this class (e.g. "flex flex-1"). */
  contentClassName?: string;
}

export default function SidebarLayout({
  user,
  isAuthenticated,
  activeView,
  isCollapsed,
  onToggleCollapse,
  children,
  outerClassName = 'flex h-screen w-screen bg-white dark:bg-slate-900',
  contentClassName,
}: SidebarLayoutProps) {
  return (
    <div className={outerClassName}>
      <Sidebar
        user={user}
        isLoggedIn={isAuthenticated}
        activeView={activeView}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
      />
      {contentClassName ? <div className={contentClassName}>{children}</div> : children}
    </div>
  );
}
