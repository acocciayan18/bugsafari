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
  children?: ReactNode;
}

export default function Sidebar({
  user,
  isLoggedIn,
  onLogout,
  activeView = 'dashboard',
  onViewChange,
}: SidebarProps) {
  return (
    <section className="w-[18%] flex flex-col border-r border-slate-200 bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 p-5">
        <h1 className="text-xl font-bold uppercase tracking-wider text-slate-900">
          BUGSAFARI
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Clinical Forensics Engine
        </p>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          <li>
            <button
              onClick={() => onViewChange?.('dashboard')}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'dashboard'
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Dashboard
            </button>
          </li>
          <li>
            <button
              onClick={() => onViewChange?.('history')}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'history'
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Forensic History
            </button>
          </li>
          <li>
            <button
              onClick={() => onViewChange?.('settings')}
              className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                activeView === 'settings'
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </li>
        </ul>
      </nav>

      {/* Footer - User Profile Card */}
      <div className="border-t border-slate-200 p-4">
        {isLoggedIn && user ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-900 truncate">
                  {user.email}
                </div>
                <div className="text-[10px] text-slate-500">
                  Logged in
                </div>
              </div>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0m-4 4V4m0 0l4 4m-4-4H3" />
                </svg>
                Logout
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-400 text-sm font-bold text-white">
              ?
            </div>
            <div className="flex-1">
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
