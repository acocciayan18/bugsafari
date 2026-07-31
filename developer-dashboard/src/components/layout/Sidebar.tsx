// Sidebar Component - NovaSpark Design System
// Handles navigation only - no telemetry logic.
// Themed via CSS-variable design tokens (auto light/dark, no dark: variants needed).

import { useNavigate } from 'react-router-dom';
import { PanelLeft, LayoutDashboard, Settings, History, Menu, X } from 'lucide-react';

interface User {
  id: string;
  email: string;
  name?: string;
}

type ViewType = 'dashboard' | 'history' | 'settings';

interface SidebarProps {
  user: User | null;
  isLoggedIn: boolean;
  activeView?: ViewType;
  /** Rail mode. Ignored while `isDrawer` — a drawer is always fully labelled. */
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Renders as an off-canvas overlay panel instead of an in-flow column. */
  isDrawer?: boolean;
  /** Drawer-only: closes the overlay after a navigation or on the close button. */
  onDismiss?: () => void;
  displayName?: string | null;
}

interface NavItem {
  view: ViewType;
  label: string;
  path: string;
  Icon: typeof LayoutDashboard;
  /** Guests persist nothing, so forensic history has no content for them. */
  requiresAuth?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'dashboard', label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
  { view: 'history', label: 'Forensic History', path: '/history', Icon: History, requiresAuth: true },
  { view: 'settings', label: 'Settings', path: '/settings', Icon: Settings },
];

// 3px left border reserves space so active/inactive don't shift layout.
function navItemClass(isActive: boolean, isRail: boolean) {
  const base =
    'flex w-full items-center gap-2.5 border-l-[3px] hover:cursor-pointer rounded-r-md px-3 py-2.5 text-sm font-medium transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-inset';
  const state = isActive
    ? 'border-(--surface-invert) bg-(--surface-invert) text-(--text-oninvert)'
    : 'border-transparent text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary)';
  return `${base} ${state} ${isRail ? 'justify-center px-2' : ''}`;
}

export default function Sidebar({
  user,
  isLoggedIn,
  activeView = 'dashboard',
  isCollapsed = false,
  onToggleCollapse,
  isDrawer = false,
  onDismiss,
  displayName,
}: SidebarProps) {
  const navigate = useNavigate();
  // A drawer overlays the content, so it always shows labels regardless of rail state.
  const isRail = isCollapsed && !isDrawer;
  const width = isDrawer ? 'w-[264px] max-w-[82vw]' : isRail ? 'w-14' : 'w-[216px]';

  const handleNavigate = (path: string) => {
    navigate(path);
    onDismiss?.();
  };

  return (
    <section
      className={`${width} h-full shrink-0 flex flex-col border-r border-(--border-hairline) bg-(--surface-panel) transition-[width] duration-200 ease-in-out overflow-hidden`}
      aria-label="Primary navigation"
    >
      <div
        className={`h-14 shrink-0 border-b border-(--border-hairline) flex items-center transition-[padding] duration-200 ${isRail ? 'px-1.5 justify-center' : 'px-3 gap-2.5'}`}
      >
        <button
          onClick={isDrawer ? onDismiss : onToggleCollapse}
          aria-label={isDrawer ? 'Close navigation' : isRail ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={isDrawer ? true : !isRail}
          className="touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-(--text-secondary) hover:cursor-pointer hover:bg-(--surface-hover) hover:text-(--text-primary) transition-colors duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
        >
          {isDrawer ? (
            <X className="h-5 w-5 shrink-0 text-current" />
          ) : isRail ? (
            <Menu className="h-5 w-5 shrink-0 text-current" />
          ) : (
            <PanelLeft className="h-5 w-5 shrink-0 text-current" />
          )}
        </button>

        <div className={`overflow-hidden transition-all duration-200 ${isRail ? 'w-0 h-0' : 'w-auto h-auto flex-1 min-w-0'}`}>
          <h1 className="font-sans font-bold text-md uppercase r text-(--text-primary) whitespace-nowrap leading-none">
            BUGSAFARI
          </h1>
          <p className="mt-0.5 font-sans font-medium text-xs text-(--text-secondary) whitespace-nowrap leading-none r">
            TERMINAL ACCESS
          </p>
        </div>
      </div>

      <nav className={`flex-1 overflow-y-auto custom-scrollbar ${isRail ? 'p-1' : 'p-2'}`}>
        <ul className={isRail ? 'space-y-2' : 'space-y-1'}>
          {NAV_ITEMS.filter((item) => !item.requiresAuth || isLoggedIn).map(({ view, label, path, Icon }) => (
            <li key={view}>
              <button
                onClick={() => handleNavigate(path)}
                className={navItemClass(activeView === view, isRail)}
                title={isRail ? label : undefined}
                aria-current={activeView === view ? 'page' : undefined}
              >
                <Icon className="h-5 w-5 shrink-0 text-current" />
                <span className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${isRail ? 'w-0' : 'w-auto'}`}>
                  {label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div
  className={`shrink-0 border-t border-(--border-hairline) pb-safe transition-[padding] duration-200 ${
    isRail ? 'p-2 mb-2' : 'p-3 mb-2'
  }`}
>
  <div
    className={`flex items-center transition-all duration-200 ${
      isRail ? 'justify-center' : 'gap-3'
    }`}
  >
    {isLoggedIn && user && (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--surface-invert) text-sm font-semibold text-(--text-oninvert)">
        {(displayName || user.email).charAt(0).toUpperCase()}
      </div>
    )}

    <div
      className={`overflow-hidden transition-all duration-200 ${
        isRail ? 'w-0' : 'min-w-0 flex-1'
      }`}
    >
      <div className="truncate text-sm font-medium text-(--text-primary)">
        {isLoggedIn && user ? displayName || 'User' : 'Guest User'}
      </div>
    </div>
  </div>
</div>
    </section>
  );
}
