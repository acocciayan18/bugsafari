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

import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDismissableLayer } from '../../hooks/useDismissableLayer';
import { Download, EllipsisVertical, LoaderCircle, Scroll, Trash2 } from 'lucide-react';

const MENU_WIDTH = 192;
const MENU_HEIGHT_ESTIMATE = 132;

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
  const [flipUp, setFlipUp] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Right-aligned w-48 panel can fall off either viewport edge in a narrow table; measure and flip.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setFlipUp(rect.bottom + MENU_HEIGHT_ESTIMATE > window.innerHeight && rect.top > MENU_HEIGHT_ESTIMATE);
    setAlignLeft(rect.right - MENU_WIDTH < 8);
  }, [isOpen]);

  const closeMenu = () => {
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const menuRef = useDismissableLayer<HTMLDivElement>({ isOpen, onDismiss: closeMenu });

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
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ease-in-out ${
          disabled || isLoading
            ? 'cursor-not-allowed opacity-40'
            : 'hover:bg-(--surface-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2'
        }`}
        aria-label={recordId ? `Actions for record ${recordId.slice(-8)}` : 'Record actions menu'}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {isLoading ? (
          <LoaderCircle className="h-5 w-5 animate-spin text-(--text-tertiary)" aria-hidden="true" />
        ) : (
          <EllipsisVertical className="h-5 w-5 text-(--text-secondary) hover:cursor-pointer" aria-hidden="true" />
        )}
      </button>

      {/* Dropdown menu */}
      <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: flipUp ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: flipUp ? 4 : -4 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className={`absolute z-50 w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-(--border-hairline) bg-(--surface-panel) py-1 shadow-lg ${
            flipUp ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1 origin-top'
          } ${alignLeft ? 'left-0' : 'right-0'}`}
          role="menu"
        >
          <button
            onClick={() => handleItemClick(onViewReport)}
            disabled={disabled || isLoading}
            className="flex w-full hover:cursor-pointer items-center gap-3 px-3 py-2.5 sm:py-2 text-left text-[13px] text-(--text-primary) hover:bg-(--surface-hover) disabled:opacity-40"
            role="menuitem"
          >
            
            <Scroll className="h-4 w-4 shrink-0 text-(--text-secondary)" aria-hidden="true" />
            View Report
          </button>
          <button
            onClick={() => handleItemClick(onExportRecord)}
            disabled={disabled || isLoading}
            className="flex w-full hover:cursor-pointer items-center gap-3 px-3 py-2.5 sm:py-2 text-left text-[13px] text-(--text-primary) hover:bg-(--surface-hover) disabled:opacity-40"
            role="menuitem"
          >
            <Download className="h-4 w-4 shrink-0 text-(--text-secondary)" aria-hidden="true" />
            Export Record
          </button>
          <button
            onClick={() => handleItemClick(onDeleteRecord)}
            disabled={disabled || isLoading}
            className="flex w-full hover:cursor-pointer items-center gap-3 px-3 py-2.5 sm:py-2 text-left text-[13px] text-(--status-critical-fg) hover:bg-(--status-critical-bg) disabled:opacity-40"
            role="menuitem"
          >
            <Trash2 className="h-4 w-4 shrink-0 text-(--status-critical-fg) " aria-hidden="true" />
            Delete Record
          </button>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

export default RowActionMenu;
