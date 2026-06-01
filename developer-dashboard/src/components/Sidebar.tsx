// Sidebar Component - Monochrome Developer Aesthetic
// Extracted from ClinicalForensicsDashboard for proper component separation
// Handles navigation only - no telemetry logic

import type { ReactNode } from 'react';

interface User {
  id: string;
  email: string;
}

interface SidebarProps {
  user: User | null;
  isLoggedIn: boolean;
  onLogout?: () => void;
  activeView?: 'dashboard' | 'history' | 'settings';
  onViewChange?: (view: 'dashboard' | 'history' | 'settings') => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  children?: ReactNode;
}

export default function Sidebar({
  user,
  isLoggedIn,
  onLogout,
  activeView = 'dashboard',
  onViewChange,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-[18%]';

  return (
    <section className={`${sidebarWidth} flex flex-col border-r border-slate-200 bg-slate-50 transition-[width] duration-300 ease-in-out overflow-hidden`}>
      {/* Header */}
      <div className={`border-b border-slate-200 transition-[padding] duration-300 ${isCollapsed ? 'p-2 flex justify-center' : 'p-5'}`}>
        {/* Hamburger Toggle Button - inside sidebar, centered horizontally in mini-rail */}
        <button
          onClick={onToggleCollapse}
          className={`flex items-center justify-center rounded-lg hover:bg-slate-200 transition-colors ${isCollapsed ? 'mb-2' : 'mb-3'}`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        
        {/* Content always rendered but clipped when collapsed - prevents squishing */}
        <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'w-0 h-0' : 'w-auto h-auto'}`}>
          <h1 className="text-xl font-bold uppercase tracking-wider text-slate-900 whitespace-nowrap">
            BUGSAFARI
          </h1>
          <p className="mt-1 text-xs text-slate-500 whitespace-nowrap">
            Clinical Forensics Engine
          </p>
        </div>
      </div>

      {/* Navigation Links - Always showing, clipped when collapsed */}
      <nav className={`flex-1 ${isCollapsed ? 'p-1' : 'p-4'}`}>
        <ul className={`${isCollapsed ? 'space-y-2' : 'space-y-1'}`}>
          <li>
            <button
              onClick={() => onViewChange?.('dashboard')}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'dashboard'
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
              title={isCollapsed ? 'Dashboard' : undefined}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Dashboard
              </span>
            </button>
          </li>
          <li>
            <button
              onClick={() => onViewChange?.('history')}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'history'
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
              title={isCollapsed ? 'Forensic History' : undefined}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Forensic History
              </span>
            </button>
          </li>
          <li>
            <button
              onClick={() => onViewChange?.('settings')}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'settings'
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
              title={isCollapsed ? 'Settings' : undefined}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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

      {/* Footer - User Profile Card - Shows only icon when collapsed */}
      <div className={`border-t border-slate-200 transition-[padding] duration-300 ${isCollapsed ? 'p-2' : 'p-4'}`}>
        {isLoggedIn && user ? (
          <div className={`${isCollapsed ? '' : 'space-y-2'}`}>
            <div className={`flex items-center rounded-lg border border-slate-200 bg-white transition-all duration-200 ${isCollapsed ? 'p-1 justify-center' : 'gap-3 p-3'}`}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1 min-w-0'}`}>
                <div className="text-xs font-medium text-slate-900 truncate">
                  {user.email}
                </div>
                <div className="text-[10px] text-slate-500">
                  Logged in
                </div>
              </div>
            </div>
            <button
              onClick={onLogout}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-all duration-200 ${isCollapsed ? 'h-0 p-0 opacity-0 overflow-hidden' : 'opacity-100 py-2'}`}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0m-4 4V4m0 0l4 4m-4-4H3" />
              </svg>
              Logout
            </button>
          </div>
        ) : (
          <div className={`flex items-center rounded-lg border border-slate-200 bg-white transition-all duration-200 ${isCollapsed ? 'p-1 justify-center' : 'gap-3 p-3'}`}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-400 text-sm font-bold text-white">
              ?
            </div>
            <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1'}`}>
              <div className="text-xs font-medium text-slate-900">
                Guest User
              </div>
              <div className="text-[10px] text-slate-500">
                Not logged in
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
