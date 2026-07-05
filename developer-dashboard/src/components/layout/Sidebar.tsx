// Sidebar Component - Monochrome Developer Aesthetic
// Handles navigation only - no telemetry logic.
// Supports light and dark mode via Tailwind dark: variants.

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import HelpMenuIcon from '../common/HelpMenuIcon';

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
    ? 'border-nova-blue bg-blue-50 text-nova-blue dark:bg-blue-950/40 dark:text-blue-400'
    : 'border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';
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
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-60';

  return (
    <section className={`${sidebarWidth} shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-nova-light dark:bg-nova-dark transition-[width] duration-[350ms] ease-in-out overflow-hidden`}>
      {/* Header */}
      <div className={`border-b border-gray-200 dark:border-gray-700 transition-[padding] duration-[350ms] ${isCollapsed ? 'p-2 flex justify-center' : 'p-5 flex items-center gap-3'}`}>
        <button
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex h-11 w-11 items-center justify-center rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2 ${isCollapsed ? 'mb-2' : ''}`}
        >
          <svg className="h-6 w-6 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* BUGSAFARI branding - visible when expanded */}
        <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'w-0 h-0' : 'w-auto h-auto flex-1'}`}>
          <h1 className="text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100 whitespace-nowrap">
            BUGSAFARI
          </h1>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            Clinical Forensics Engine
          </p>
        </div>

        {/* Help Menu - visible when collapsed */}
        <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'w-auto h-auto' : 'w-0 h-0'}`}>
          <HelpMenuIcon />
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
              title={isCollapsed ? 'Sessions History' : undefined}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Sessions History
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
      <div className={`border-t border-gray-200 dark:border-gray-700 transition-[padding] duration-[350ms] ${isCollapsed ? 'p-2' : 'p-4'}`}>
        {isLoggedIn && user ? (
          <div className={`${isCollapsed ? '' : 'space-y-2'}`}>
            <div className={`flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-all duration-200 ${isCollapsed ? 'p-2 justify-center' : 'gap-3 p-3'}`}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-nova-dark dark:bg-gray-600 text-base font-bold text-white">
                {(displayName || user.email).charAt(0).toUpperCase()}
              </div>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1 min-w-0'}`}>
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                  {displayName || user.email}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  {displayName ? 'Logged in' : user.email}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={`${isCollapsed ? '' : 'space-y-2'}`}>
            <div className={`flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-all duration-200 ${isCollapsed ? 'p-2 justify-center' : 'gap-3 p-3'}`}>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1'}`}>
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                  Guest User
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  Guest mode
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate('/')}
              className={`flex w-full items-center justify-center gap-2 rounded-md bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-200 transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2 ${isCollapsed ? 'h-0 p-0 opacity-0 overflow-hidden' : 'opacity-100 py-2'}`}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0m-4 4V4m0 0l4 4m-4-4H3" />
              </svg>
              Back to Landingpage
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
