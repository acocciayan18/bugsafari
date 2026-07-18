// Sidebar Component - NovaSpark Design System
// Handles navigation only - no telemetry logic.
// Supports light and dark mode via Tailwind dark: variants.

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
  const base = 'flex w-full items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-sm font-medium transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2';
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
  const sidebarWidth = isCollapsed ? 'w-14' : 'w-[216px]';

  return (
    <section 
      className={`${sidebarWidth} shrink-0 flex flex-col border-r border-gray-300 dark:border-slate-700 bg-nova-light dark:bg-nova-dark transition-[width] duration-200 ease-in-out overflow-hidden`}
    >
      {/* Header */}
      <div className={`h-14 shrink-0 border-b border-gray-300 dark:border-slate-700 flex items-center transition-[padding] duration-200 ${isCollapsed ? 'px-1.5 justify-center' : 'px-3 gap-2.5'}`}>
        <button
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
        >
          {isCollapsed ? (
            /* Burger icon shows ONLY when closed/collapsed to expand it open */
           
            <Menu className="h-4 w-4  text-gray-600  dark:text-slate-400"/>
          ) : (
            /* Custom Sidebar Layout Box Icon shows ONLY when open to close/collapse it */
           <PanelLeft className="h-4 w-4 text-gray-600  dark:text-slate-400" />
          )}
        </button>

        {/* BUGSAFARI Branding - Inter, Bold, 20px, Color #2563EB */}
        <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'w-0 h-0' : 'w-auto h-auto flex-1'}`}>
          <h1 className="font-sans font-bold text-[18px] uppercase tracking-wider text-nova-blue whitespace-nowrap leading-none">
            BUGSAFARI
          </h1>
          {/* TERMINAL ACCESS - Inter, Medium, 10px */}
          <p className="mt-0.5 font-sans font-medium text-[10px] text-gray-600 dark:text-slate-400 whitespace-nowrap leading-none tracking-wider">
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
               <LayoutDashboard className="h-4 w-4 text-gray-600  dark:text-slate-400"/>
              
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
              <History className="h-4 w-4 text-gray-600  dark:text-slate-400" />
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
              <Settings className="h-4 w-4 text-gray-600  dark:text-slate-400" />
              <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'w-auto'}`}>
                Settings
              </span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Footer - User Profile Card */}
      <div className={`border-t border-gray-300 dark:border-slate-700 transition-[padding] duration-200 ${isCollapsed ? 'p-1.5' : 'p-2'}`}>
        {isLoggedIn && user ? (
          <div>
            <div className={`flex items-center rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all duration-200 ${isCollapsed ? 'p-1.5 justify-center' : 'gap-2.5 p-2.5'}`}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nova-dark dark:bg-slate-700 text-sm font-bold text-white">
                {(displayName || user.email).charAt(0).toUpperCase()}
              </div>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1 min-w-0'}`}>
                {/* Admin/User Name: Inter, Bold, Size 12px */}
                <div className="font-sans font-bold text-[11px] text-gray-900 dark:text-slate-100 truncate">
                  {displayName || 'ADMIN_01'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className={`flex items-center rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all duration-200 ${isCollapsed ? 'p-1.5 justify-center' : 'gap-2.5 p-2.5'}`}>
              <div className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isCollapsed ? 'w-0' : 'flex-1'}`}>
                <div className="font-sans font-bold text-[11px] text-gray-900 dark:text-slate-100">
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