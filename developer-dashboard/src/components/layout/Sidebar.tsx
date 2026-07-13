// Sidebar Component - NovaSpark Design System
// Handles navigation only - no telemetry logic.
// Supports light and dark mode via Tailwind dark: variants.

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

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
  const base = 'flex w-full items-center gap-3 border-l-[3px] px-4 py-3 text-sm font-medium transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2';
  const state = isActive
    ? 'border-nova-blue bg-blue-100 text-nova-blue dark:bg-slate-800 dark:text-blue-400'
    : 'border-transparent text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100';
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
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-[240px]';

  return (
    <section 
      className={`${sidebarWidth} shrink-0 flex flex-col border-r border-gray-300 dark:border-slate-700 bg-nova-light dark:bg-nova-dark transition-[width] duration-200 ease-in-out overflow-hidden`}
    >
      {/* Header */}
      <div className={`h-16 shrink-0 border-b border-gray-300 dark:border-slate-700 flex items-center transition-[padding] duration-200 ${isCollapsed ? 'px-2 justify-center' : 'px-4 gap-3'}`}>
        <button
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
        >
          {isCollapsed ? (
            /* Burger icon shows ONLY when closed/collapsed to expand it open */
            <svg className="h-5 w-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          ) : (
            /* Custom Sidebar Layout Box Icon shows ONLY when open to close/collapse it */
            <svg className="h-5 w-5 text-gray-600 dark:text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          )}
        </button>

        {/* BUGSAFARI Branding - Inter, Bold, 20px, Color #2563EB */}
        <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'w-0 h-0' : 'w-auto h-auto flex-1'}`}>
          <h1 className="font-sans font-bold text-[20px] uppercase tracking-wider text-nova-blue whitespace-nowrap leading-none">
            BUGSAFARI
          </h1>
          {/* TERMINAL ACCESS - Inter, Medium, 10px */}
          <p className="mt-1 font-sans font-medium text-[10px] text-gray-600 dark:text-slate-400 whitespace-nowrap leading-none tracking-wider">
            TERMINAL ACCESS
          </p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className={`flex-1 ${isCollapsed ? 'p-1' : 'p-4'}`}>
        <ul className={`${isCollapsed ? 'space-y-3' : 'space-y-1'}`}>
          <li>
            <button
              onClick={() => navigate('/dashboard')}
              className={navItemClass(activeView === 'dashboard', isCollapsed)}
              title={isCollapsed ? 'Dashboard' : undefined}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Dashboard
              </span>
            </button>
          </li>
          <li>
            <button
              onClick={() => navigate('/history')}
              className={navItemClass(activeView === 'history', isCollapsed)}
              title={isCollapsed ? 'Forensic History' : undefined}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Forensic History
              </span>
            </button>
          </li>
          <li>
            <button
              onClick={() => navigate('/settings')}
              className={navItemClass(activeView === 'settings', isCollapsed)}
              title={isCollapsed ? 'Settings' : undefined}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Settings
              </span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Footer - User Profile Card */}
      <div className={`border-t border-gray-300 dark:border-slate-700 transition-[padding] duration-200 ${isCollapsed ? 'p-2' : 'p-4'}`}>
        {isLoggedIn && user ? (
          <div className={`${isCollapsed ? '' : 'space-y-3'}`}>
            <div className={`flex items-center rounded-xl border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md transition-all duration-200 ${isCollapsed ? 'p-1.5 justify-center' : 'gap-3 p-3'}`}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-nova-dark dark:bg-slate-700 text-base font-bold text-white">
                {(displayName || user.email).charAt(0).toUpperCase()}
              </div>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1 min-w-0'}`}>
                {/* Admin/User Name: Inter, Bold, Size 12px */}
                <div className="font-sans font-bold text-[12px] text-gray-900 dark:text-slate-100 truncate">
                  {displayName || 'ADMIN_01'}
                </div>
              </div>
            </div>

            {/* LOG OUT Button: Inter, Bold, Size 12px */}
            <button
              onClick={() => navigate('/')}
              className={`flex w-full h-10 items-center justify-center rounded-md bg-nova-blue px-4 font-sans font-bold text-[12px] text-white hover:bg-blue-700 active:bg-blue-800 transition-all duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2 ${isCollapsed ? 'h-0 p-0 opacity-0 overflow-hidden' : 'opacity-100'}`}
            >
              LOG OUT
            </button>
          </div>
        ) : (
          <div className={`${isCollapsed ? '' : 'space-y-3'}`}>
            <div className={`flex items-center rounded-xl border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md transition-all duration-200 ${isCollapsed ? 'p-1.5 justify-center' : 'gap-3 p-3'}`}>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1'}`}>
                <div className="font-sans font-bold text-[12px] text-gray-900 dark:text-slate-100">
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