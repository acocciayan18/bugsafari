// ═══════════════════════════════════════════════════════════════
// RowActionMenu.tsx - Three-dot Action Menu for Forensic Records
// ═══════════════════════════════════════════════════════════════
// A dropdown menu for each forensic record with actions:
// - Export Record
// - Delete Record
//
// Features:
// - Keyboard accessible (Enter to open, Escape to close)
// - Tab navigation through menu items
// - Click outside to close
// - Accessible labels

import { useEffect, useRef, useState } from 'react';

interface RowActionMenuProps {
  recordId?: string;
  targetUrl?: string;
  onViewReport: () => void;
  onExportRecord: () => void;
  onDeleteRecord: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

/**
 * RowActionMenu - Three-dot menu for record actions
 * 
 * Features:
 * - Keyboard accessible navigation
 * - Enter to open menu, Escape to close
 * - Tab navigation through items
 * - Click outside to close
 */
export function RowActionMenu({
  recordId,
  onViewReport,
  onExportRecord,
  onDeleteRecord,
  isLoading = false,
  disabled = false,
}: RowActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu helper
  const closeMenu = () => {
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard for button
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || isLoading) return;

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        setIsOpen(!isOpen);
        break;
      case 'Escape':
        e.preventDefault();
        if (isOpen) closeMenu();
        break;
    }
  };

  // Handle menu item selection
  const handleItemClick = (action: () => void) => {
    if (disabled || isLoading) return;
    closeMenu();
    setTimeout(() => action(), 50);
  };

  return (
    <div ref={menuRef} className="relative">
      {/* Menu trigger button */}
      <button
        ref={buttonRef}
        onClick={() => {
          if (!disabled && !isLoading) setIsOpen(!isOpen);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled || isLoading}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          disabled || isLoading
            ? 'cursor-not-allowed opacity-50'
            : 'hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2'
        }`}
        aria-label={recordId ? `Actions for record ${recordId.slice(-8)}` : 'Record actions menu'}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {isLoading ? (
          <svg className="h-4 w-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="h-5 w-5 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        )}
      </button>

{/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg" role="menu">
          <button
            onClick={() => handleItemClick(onViewReport)}
            disabled={disabled || isLoading}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            role="menuitem"
          >
            <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            View Report
          </button>
          <button
            onClick={() => handleItemClick(onExportRecord)}
            disabled={disabled || isLoading}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            role="menuitem"
          >
            <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Record
          </button>
          <button
            onClick={() => handleItemClick(onDeleteRecord)}
            disabled={disabled || isLoading}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            role="menuitem"
          >
            <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Record
          </button>
        </div>
      )}
    </div>
  );
}

export default RowActionMenu;
