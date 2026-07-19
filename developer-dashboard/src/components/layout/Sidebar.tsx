// Sidebar Component - NovaSpark Design System
// Handles navigation only - no telemetry logic.
// Themed via CSS-variable design tokens (auto light/dark, no dark: variants needed).

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeft, LayoutDashboard, Settings, History, Menu   } from 'lucide-react';



interface User {
  id: string;
  email: string;
  name?: string;
}

interface SidebarProps {
  user: User | null;
  isLoggedIn: boolean;
  activeView?: 'dashboard' | 'history' | 'settings';
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  displayName?: string | null;
  children?: ReactNode;
}

/** Shared classes for a nav item — 3px left border reserves space so active/inactive don't shift layout. */
function navItemClass(isActive: boolean, isCollapsed: boolean) {
  const base = 'flex w-full items-center gap-2.5 border-l-[3px] hover:cursor-pointer px-3 py-2.5 text-sm font-medium transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2';
  const state = isActive
    ? 'border-(--surface-invert) bg-(--surface-invert) text-(--text-oninvert)'
    : 'border-transparent text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary)';
  const layout = isCollapsed ? 'justify-center px-2' : '';
  return `${base} ${state} ${layout}`;
}

export default function Sidebar({
  user,
  isLoggedIn,
  activeView = 'dashboard',
  isCollapsed = false,
  onToggleCollapse,
  displayName,
}: SidebarProps) {
  const navigate = useNavigate();
  const sidebarWidth = isCollapsed ? 'w-14' : 'w-[216px]';

  return (
    <section
      className={`${sidebarWidth} shrink-0 flex flex-col border-r border-(--border-hairline) bg-(--surface-panel) transition-[width] duration-200 ease-in-out overflow-hidden`}
    >
      {/* Header */}
      <div className={`h-14 shrink-0 border-b border-(--border-hairline) flex items-center transition-[padding] duration-200 ${isCollapsed ? 'px-1.5 justify-center' : 'px-3 gap-2.5'}`}>
        <button
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-(--text-secondary) hover:cursor-pointer hover:text-(--text-primary) transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
        >
          {isCollapsed ? (
            <Menu className="h-5 w-5 shrink-0 text-current"/>
          ) : (
            <PanelLeft className="h-5 w-5 shrink-0 text-current" />
          )}
        </button>

        {/* BUGSAFARI Branding - Inter, Bold, 20px */}
        <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'w-0 h-0' : 'w-auto h-auto flex-1'}`}>
          <h1 className="font-sans font-bold text-[18px] uppercase tracking-wider text-(--text-primary) whitespace-nowrap leading-none">
            BUGSAFARI
          </h1>
          {/* TERMINAL ACCESS - Inter, Medium, 10px */}
          <p className="mt-0.5 font-sans font-medium text-[10px] text-(--text-secondary) whitespace-nowrap leading-none tracking-wider">
            TERMINAL ACCESS
          </p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className={`flex-1 ${isCollapsed ? 'p-1' : 'p-2'}`}>
        <ul className={`${isCollapsed ? 'space-y-2' : 'space-y-1'}`}>
          <li>
            <button
              onClick={() => navigate('/dashboard')}
              className={navItemClass(activeView === 'dashboard', isCollapsed)}
              title={isCollapsed ? 'Dashboard' : undefined}
            >
               <LayoutDashboard className="h-5 w-5 shrink-0 text-current"/>

              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Dashboard
              </span>
            </button>
          </li>
          {/* Guests persist nothing, so forensic history has no content for them. */}
          {isLoggedIn && (
            <li>
              <button
                onClick={() => navigate('/history')}
                className={navItemClass(activeView === 'history', isCollapsed)}
                title={isCollapsed ? 'Forensic History' : undefined}
              >
                <History className="h-5 w-5 shrink-0 text-current" />
                <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                  Forensic History
                </span>
              </button>
            </li>
          )}
          <li>
            <button
              onClick={() => navigate('/settings')}
              className={navItemClass(activeView === 'settings', isCollapsed)}
              title={isCollapsed ? 'Settings' : undefined}
            >
              <Settings className="h-5 w-5 shrink-0 text-current" />
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Settings
              </span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Footer - User Profile Card */}
      <div className={`border-t border-(--border-hairline) transition-[padding] duration-200 ${isCollapsed ? 'p-1.5' : 'p-2'}`}>
        {isLoggedIn && user ? (
          <div>
            <div className={`flex items-center rounded-lg border border-(--border-hairline) bg-(--surface-raised) transition-all duration-200 ${isCollapsed ? 'p-1.5 justify-center' : 'gap-2.5 p-2.5'}`}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--surface-invert) text-sm font-bold text-(--text-oninvert)">
                {(displayName || user.email).charAt(0).toUpperCase()}
              </div>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1 min-w-0'}`}>
                {/* Admin/User Name: Inter, Bold, Size 12px */}
                <div className="font-sans font-bold text-[11px] text-(--text-primary) truncate">
                  {displayName || 'ADMIN_01'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className={`flex items-center rounded-lg border border-(--border-hairline) bg-(--surface-raised) transition-all duration-200 ${isCollapsed ? 'p-1.5 justify-center' : 'gap-2.5 p-2.5'}`}>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1'}`}>
                <div className="font-sans font-bold text-[11px] text-(--text-primary)">
                  Guest User
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}