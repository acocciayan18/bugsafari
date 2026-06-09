// Sidebar Component - Command Center Layout
// Refactored to fixed-width full-text navigation menu
// Part of 2-column layout: Sidebar | Main Content

import { useNavigate } from 'react-router-dom';

interface User {
  id: string;
  email: string;
}

interface SidebarProps {
  user: User | null;
  isLoggedIn: boolean;
  onLogout?: () => void;
  activeView?: 'dashboard' | 'history' | 'settings';
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({
  user,
  isLoggedIn,
  onLogout,
  activeView = 'dashboard',
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const navigate = useNavigate();

  // Navigation items with icons
  const navItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      path: '/dashboard',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      id: 'history',
      label: 'Forensic History',
      path: '/history',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      path: '/settings',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  return (
    <aside className={`${isCollapsed ? 'w-20' : 'w-72'} flex flex-col h-screen bg-white border-r border-gray-200 transition-all duration-300`}>
      {/* Header - BUGSAFARI Logo + Burger Menu */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              {isCollapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        )}
        {!isCollapsed && (
          <div>
            <h1 className="text-lg font-bold uppercase tracking-wider text-gray-900">
              BUGSAFARI
            </h1>
            <p className="text-[10px] text-gray-500">
              Forensics Engine
            </p>
          </div>
        )}
        {isCollapsed && (
          <div className="flex-1 flex justify-center">
            <span className="text-lg font-bold text-gray-900">B</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 ${isCollapsed ? 'p-2' : 'p-4'}`}>
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => navigate(item.path)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 py-3 text-sm font-medium transition-all duration-200 rounded-lg ${isActive
                      ? 'bg-gray-900 text-white border-l-4 border-gray-900'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    } ${isCollapsed ? 'justify-center px-2' : 'px-4'}`}
                >
                  <span className={isActive ? 'text-white' : 'text-gray-500'}>
                    {item.icon}
                  </span>
                  {!isCollapsed && <span>{item.label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer - User Profile Card */}
      <div className={`${isCollapsed ? 'p-2' : 'p-4'} border-t border-gray-200`}>
        {isLoggedIn && user ? (
          <div className="space-y-2">
            <div className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 ${isCollapsed ? 'justify-center p-2' : 'p-3'}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-900 text-xs font-bold text-white">
                {user.email.charAt(0).toUpperCase()}
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate">
                    {user.email}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Logged in
                  </div>
                </div>
              )}
            </div>
            {!isCollapsed && (
              <button
                onClick={onLogout}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0m-4 4V4m0 0l4 4m-4-4H3" />
                </svg>
                Logout
              </button>
            )}
            {isCollapsed && (
              <button
                onClick={onLogout}
                title="Logout"
                className="w-full flex justify-center p-2 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0m-4 4V4m0 0l4 4m-4-4H3" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <div className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 ${isCollapsed ? 'justify-center p-2' : 'p-3'}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-400 text-xs font-bold text-white">
              ?
            </div>
            {!isCollapsed && (
              <div className="flex-1">
                <div className="text-xs font-medium text-gray-900">
                  Guest User
                </div>
                <div className="text-[10px] text-gray-500">
                  Not logged in
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
