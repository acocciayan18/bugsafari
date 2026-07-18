// HelpMenuIcon.tsx - Help & Support Question Mark Menu
// Provides quick access to help resources, documentation, and system info

import { useRef, useState, type ReactNode } from 'react';
import { useDismissableLayer } from '../../hooks/useDismissableLayer';
import SupportModal from './SupportModal';

// Severity level descriptions
const severityLevels = [
  {
    level: 'Critical',
    description: 'Immediate security threat, data breach risk, or potential system crash. Requires urgent action.',
    color: 'text-[var(--status-critical-fg)]',
    bg: 'bg-[var(--status-critical-bg)]',
  },
  {
    level: 'High',
    description: 'Significant vulnerability that could lead to security breaches or major functionality issues.',
    color: 'text-[var(--status-warning-fg)]',
    bg: 'bg-[var(--status-warning-bg)]',
  },
  {
    level: 'Medium',
    description: 'Moderate impact issue that affects user experience or exposes minor security risks.',
    color: 'text-[var(--status-warning-fg)]',
    bg: 'bg-[var(--status-warning-bg)]',
  },
  {
    level: 'Low',
    description: 'Minor issue with minimal impact on functionality or security posture.',
    color: 'text-[var(--status-neutral-fg)]',
    bg: 'bg-[var(--status-neutral-bg)]',
  },
];

// Documentation links
const documentationLinks = [
  {
    title: 'Knowledge Base',
    description: 'Common questions and answers about BugSafari features',
    url: '#knowledge-base',
    icon: 'M12 6.253v14m0-14C7.256 6.253 4.5 9.253 4.5 12s2.756 6 6.5 6 6.5-2.756 6.5-6S13.744 6.253 12 6.253z',
  },
  {
    title: 'Wiki',
    description: 'Detailed documentation and guides',
    url: '#wiki',
    icon: 'M12 6.253v14m0-14C7.256 6.253 4.5 9.253 4.5 12s2.756 6 6.5 6 6.5-2.756 6.5-6S13.744 6.253 12 6.253zM12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
  },
  {
    title: 'API Documentation',
    description: 'Developer API reference and endpoints',
    url: '#api-docs',
    icon: 'M10 20l4-16m4 16l-4-4m4 4l4-4M2 7l6 6M2 7l6-6M2 17l6 6M2 17l6-6',
  },
];

// Accordion section props
interface AccordionSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function AccordionSection({ title, isOpen, onToggle, children }: AccordionSectionProps) {
  return (
    <div className="border-b border-[var(--border-hairline)] last:border-b-0">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out"
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <svg
          className={`h-5 w-5 text-[var(--text-tertiary)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * HelpMenuIcon - Question mark icon that opens a dropdown menu
 *
 * Features:
 * - Click to open dropdown menu
 * - Open/close animations (fade + scale)
 * - Click outside to close
 * - ESC key to close
 * - Keyboard accessible
 * - Expandable accordions for definitions and documentation
 *
 * Menu Items:
 * - Definitions (with accordions)
 * - Documentation (with accordions)
 * - Support
 * - System Status
 * - Keyboard Shortcuts
 */
type SupportMode = 'contact' | 'ticket' | 'feature';

export function HelpMenuIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [supportMode, setSupportMode] = useState<SupportMode | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggleSection = (section: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const isSectionOpen = (section: string) => openSections.has(section);

  const closeMenu = () => {
    setIsOpen(false);
    setOpenSections(new Set());
    buttonRef.current?.focus();
  };

  const menuRef = useDismissableLayer<HTMLDivElement>({ isOpen, onDismiss: closeMenu });

  const closeSupportModal = () => {
    setSupportMode(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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

  return (
    <div ref={menuRef} className="relative">
      {/* Help icon button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className="flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200 ease-in-out hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
        aria-label="Help and Support"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <svg className="h-5 w-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-1.165 2.578 0a1.724 1.724 0 002.773 1.072c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-panel)] py-2 shadow-lg max-h-[70vh] overflow-y-auto"
          role="menu"
        >
          {/* Menu Header */}
          <div className="border-b border-[var(--border-hairline)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Help & Support</h3>
            <p className="text-xs text-[var(--text-secondary)]">BugSafari v8.2.19</p>
          </div>

          {/* Definitions - with accordions */}
          <AccordionSection
            title="Definitions"
            isOpen={isSectionOpen('definitions')}
            onToggle={() => toggleSection('definitions')}
          >
            <div className="space-y-3 mt-2">
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">What is a Safari?</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  A Safari is an autonomous test execution that explores and analyzes a target web application to discover potential bugs, vulnerabilities, and issues.
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">Severity Levels</p>
                <div className="mt-2 space-y-2">
                  {severityLevels.map((sev) => (
                    <div key={sev.level} className={`rounded-md p-2 ${sev.bg}`}>
                      <p className={`text-xs font-semibold ${sev.color}`}>{sev.level}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">{sev.description}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">Coverage Metric</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Coverage percentage represents the proportion of discovered application surfaces explored during testing.
                </p>
              </div>
            </div>
          </AccordionSection>

          {/* Documentation - with links */}
          <AccordionSection
            title="Documentation"
            isOpen={isSectionOpen('documentation')}
            onToggle={() => toggleSection('documentation')}
          >
            <div className="space-y-2 mt-2">
              {documentationLinks.map((link) => (
                <a
                  key={link.title}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 p-2 rounded-md hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out"
                >
                  <svg className="h-5 w-5 text-[var(--text-tertiary)] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d={link.icon} />
                  </svg>
                  <div>
                    <p className="text-xs font-medium text-[var(--text-primary)]">{link.title}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{link.description}</p>
                  </div>
                  <svg className="h-3 w-3 text-[var(--text-disabled)] mt-0.5 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
            </div>
          </AccordionSection>

          {/* Support - Contact Support */}
          <button
            onClick={() => setSupportMode('contact')}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out"
            role="menuitem"
          >
            <svg className="h-5 w-5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Contact Support
          </button>

          {/* Support - Open Ticket */}
          <button
            onClick={() => setSupportMode('ticket')}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out"
            role="menuitem"
          >
            <svg className="h-5 w-5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            Open Ticket
          </button>

          {/* Support - Suggest Feature */}
          <button
            onClick={() => setSupportMode('feature')}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out"
            role="menuitem"
          >
            <svg className="h-5 w-5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Suggest Feature
          </button>

          {/* System Status */}
          <button
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out"
            role="menuitem"
          >
            <svg className="h-5 w-5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            System Status
          </button>

          {/* Keyboard Shortcuts */}
          <button
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out"
            role="menuitem"
          >
            <svg className="h-5 w-5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l10-10a6 6 0 017.743-5.743L15 7z" />
            </svg>
            Keyboard Shortcuts
          </button>

          {/* Menu Footer */}
          <div className="border-t border-[var(--border-hairline)] mt-2 pt-2 px-4">
            <p className="text-xs text-[var(--text-disabled)]">Press ESC to close</p>
          </div>
        </div>
      )}

      {/* Support Modal */}
      {supportMode && (
        <SupportModal
          isOpen={supportMode !== null}
          onClose={closeSupportModal}
          mode={supportMode}
        />
      )}
    </div>
  );
}

export default HelpMenuIcon;
