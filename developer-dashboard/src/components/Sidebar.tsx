// Sidebar Component - Monochrome Developer Aesthetic
// Handles navigation only - no telemetry logic.
// Supports light and dark mode via Tailwind dark: variants.

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import HelpMenuIcon from './HelpMenuIcon';

interface User {
  id: string;
  email: string;
  name?: string;
}

interface SidebarProps {
  user: User | null;
  isLoggedIn: boolean;
  onLogout?: () => void;
  activeView?: 'dashboard' | 'history' | 'settings';
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  displayName?: string | null;
  children?: ReactNode;
}

export default function Sidebar({
  user,
  isLoggedIn,
  onLogout,
  activeView = 'dashboard',
  isCollapsed = false,
  onToggleCollapse,
  displayName,
}: SidebarProps) {
  const navigate = useNavigate();
  const sidebarWidth = isCollapsed ? 'w-20' : 'w-[18%]';

  return (
    <section className={`${sidebarWidth} flex flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 transition-[width] duration-300 ease-in-out overflow-hidden`}>
      {/* Header */}
      <div className={`border-b border-slate-200 dark:border-slate-700 transition-[padding] duration-300 ${isCollapsed ? 'p-2 flex justify-center' : 'p-5 flex items-center gap-3'}`}>
        <button
          onClick={onToggleCollapse}
          className={`flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${isCollapsed ? 'mb-2' : ''}`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg className="h-6 w-6 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* BUGSAFARI branding - visible when expanded */}
        <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'w-0 h-0' : 'w-auto h-auto flex-1'}`}>
          <h1 className="text-xl font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100 whitespace-nowrap">
            BUGSAFARI
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
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
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'dashboard'
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
              title={isCollapsed ? 'Dashboard' : undefined}
            >
              <svg className="h-7 w-7 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'history'
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
              title={isCollapsed ? 'Sessions History' : undefined}
            >
              <svg className="h-7 w-7 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'settings'
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
              title={isCollapsed ? 'Settings' : undefined}
            >
              <svg className="h-7 w-7 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
      <div className={`border-t border-slate-200 dark:border-slate-700 transition-[padding] duration-300 ${isCollapsed ? 'p-2' : 'p-4'}`}>
        {isLoggedIn && user ? (
          <div className={`${isCollapsed ? '' : 'space-y-2'}`}>
            <div className={`flex items-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-all duration-200 ${isCollapsed ? 'p-2 justify-center' : 'gap-3 p-3'}`}>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-slate-900 dark:bg-slate-600 text-base font-bold text-white">
                {(displayName || user.email).charAt(0).toUpperCase()}
              </div>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1 min-w-0'}`}>
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  {displayName || user.email}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {displayName ? 'Logged in' : user.email}
                </div>
              </div>
            </div>
            <button
              onClick={onLogout}
              className={`flex w-full items-center justify-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-all duration-200 ${isCollapsed ? 'h-0 p-0 opacity-0 overflow-hidden' : 'opacity-100 py-2'}`}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0m-4 4V4m0 0l4 4m-4-4H3" />
              </svg>
              Logout
            </button>
          </div>
        ) : (
          <div className={`${isCollapsed ? '' : 'space-y-2'}`}>
            <div className={`flex items-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-all duration-200 ${isCollapsed ? 'p-2 justify-center' : 'gap-3 p-3'}`}>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1'}`}>
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                  Guest User
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  Guest mode
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate('/')}
              className={`flex w-full items-center justify-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-all duration-200 ${isCollapsed ? 'h-0 p-0 opacity-0 overflow-hidden' : 'opacity-100 py-2'}`}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
