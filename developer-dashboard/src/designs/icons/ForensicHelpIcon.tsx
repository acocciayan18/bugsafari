// ForensicHelpIcon.tsx - Help Icon for Forensic History Panel
// Provides contextual definitions specific to forensic analysis

import { ChevronDown, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// Severity level descriptions for forensic context
const severityGuidelines = [
    {
        level: 'CRITICAL',
        description: 'Immediate security threat, data breach, or system crash. JS exceptions causing page failure.',
        color: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
    },
    {
        level: 'HIGH',
        description: 'Significant vulnerability that could lead to security breaches or major functionality loss.',
        color: 'text-orange-600',
        bg: 'bg-orange-50',
        border: 'border-orange-200',
    },
    {
        level: 'MEDIUM',
        description: 'Moderate impact affecting user experience or exposing minor security risks.',
        color: 'text-yellow-600',
        bg: 'bg-yellow-50',
        border: 'border-yellow-200',
    },
    {
        level: 'LOW',
        description: 'Minor issues with minimal impact on functionality or security.',
        color: 'text-gray-600',
        bg: 'bg-gray-100',
        border: 'border-gray-200',
    },
];

// Accordion section component
interface AccordionSectionProps {
    title: string;
    isOpen: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

function AccordionSection({ title, isOpen, onToggle, children }: AccordionSectionProps) {
    return (
        <div className="border-b border-gray-100 last:border-b-0">
            <button
                onClick={onToggle}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                aria-expanded={isOpen}
            >
                <span>{title}</span>
                <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {isOpen && <div className="px-3 pb-3">{children}</div>}
        </div>
    );
}

/**
 * ForensicHelpIcon - Question mark icon for forensic history panel
 * 
 * Features:
 * - Compact dropdown menu for forensic context
 * - Click to open/close
 * - Click outside to close
 * - ESC key to close
 * - Contextual definitions:
 *   - What is a Safari?
 *   - Severity Guidelines
 *   - Coverage Metric calculation
 */
export function ForensicHelpIcon() {
    const [isOpen, setIsOpen] = useState(false);
    const [openSections, setOpenSections] = useState<Set<string>>(new Set(['safari']));
    const menuRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Toggle accordion section
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

    // Check if section is open
    const isSectionOpen = (section: string) => openSections.has(section);

    // Close menu helper
    const closeMenu = () => {
        setIsOpen(false);
        setOpenSections(new Set(['safari']));
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

    // Handle ESC key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                e.preventDefault();
                closeMenu();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Handle keyboard for button
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
        <div ref={menuRef} className="relative z-50">
            {/* Help icon button */}
            <button
                type="button"
                ref={buttonRef}
                onClick={() => {
                    console.log('ForensicHelpIcon clicked, isOpen:', !isOpen);
                    setIsOpen(!isOpen);
                }}
                onKeyDown={handleKeyDown}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1"
                aria-label="Forensic Help - What does this mean?"
                aria-haspopup="true"
                aria-expanded={isOpen}
                title="Forensic Help - What does this mean?"
            >
                <CircleHelp className="h-4 w-4 text-gray-600" strokeWidth={1.75} aria-hidden="true" />
            </button>

            {/* Dropdown menu */}
            {isOpen && (
                <div
                    className="absolute right-0 top-full z-[9999] mt-1.5 w-72 rounded-lg border border-gray-200 bg-white py-1 shadow-xl max-h-[60vh] overflow-y-auto"
                    role="menu"
                >
                    {/* Menu Header */}
                    <div className="border-b border-gray-100 px-3 py-2">
                        <h3 className="text-sm font-semibold text-gray-900">Forensic Definitions</h3>
                        <p className="text-xs text-gray-500">What does this mean?</p>
                    </div>

                    {/* Definitions Accordion */}
                    <AccordionSection
                        title="What is a Safari?"
                        isOpen={isSectionOpen('safari')}
                        onToggle={() => toggleSection('safari')}
                    >
                        <div className="mt-2 space-y-2">
                            <p className="text-xs text-gray-600">
                                A <strong>Safari</strong> is an autonomous test run where BugSafari's AI engine explores your target application to discover bugs, vulnerabilities, and issues automatically.
                            </p>
                            <div className="rounded bg-blue-50 p-2 text-xs text-gray-700">
                                <span className="font-medium">In this context:</span> The Safari is the automated exploration that generated these forensic findings.
                            </div>
                        </div>
                    </AccordionSection>

                    {/* Severity Guidelines Accordion */}
                    <AccordionSection
                        title="Severity Guidelines"
                        isOpen={isSectionOpen('severity')}
                        onToggle={() => toggleSection('severity')}
                    >
                        <div className="mt-2 space-y-2">
                            <p className="text-xs text-gray-600 mb-2">
                                How BugSafari determines threat levels:
                            </p>
                            {severityGuidelines.map((sev) => (
                                <div key={sev.level} className={`rounded border ${sev.border} p-2 ${sev.bg}`}>
                                    <p className={`text-xs font-semibold ${sev.color}`}>{sev.level}</p>
                                    <p className="text-xs text-gray-600 mt-0.5">{sev.description}</p>
                                </div>
                            ))}
                        </div>
                    </AccordionSection>

                    {/* Coverage Metric Accordion */}
                    <AccordionSection
                        title="Coverage Metric"
                        isOpen={isSectionOpen('coverage')}
                        onToggle={() => toggleSection('coverage')}
                    >
                        <div className="mt-2 space-y-2">
                            <p className="text-xs text-gray-600">
                                The <strong>Coverage %</strong> represents the percentage of your application's surfaces that BugSafari has explored and tested during this Safari run.
                            </p>
                            <div className="rounded bg-gray-100 p-2">
                                <p className="text-xs font-medium text-gray-700">Calculation:</p>
                                <p className="text-xs text-gray-600 mt-1">
                                    (Tested DOM elements / Total discoverable elements) × 100
                                </p>
                            </div>
                            <div className="rounded bg-blue-50 p-2 text-xs text-gray-700">
                                <span className="font-medium">Higher coverage</span> = More thorough testing. 76% means approximately 3/4 of your application's interactive elements were analyzed.
                            </div>
                        </div>
                    </AccordionSection>

                    {/* Breadcrumbs Explanation */}
                    <AccordionSection
                        title="What are Breadcrumbs?"
                        isOpen={isSectionOpen('breadcrumbs')}
                        onToggle={() => toggleSection('breadcrumbs')}
                    >
                        <div className="mt-2 space-y-2">
                            <p className="text-xs text-gray-600">
                                <strong>Breadcrumbs</strong> are the recorded sequence of actions BugSafari took during the Safari - like a breadcrumb trail showing the path taken to discover each finding.
                            </p>
                            <div className="rounded bg-gray-100 p-2 text-xs text-gray-700">
                                <span className="font-medium">In the Forensic Trail:</span> Each breadcrumb shows a step (click, input, navigation) that led to the discovery of an issue.
                            </div>
                        </div>
                    </AccordionSection>

                    {/* Menu Footer */}
                    <div className="border-t border-gray-100 mt-1 px-3 py-1.5">
                        <p className="text-[10px] text-gray-400">Press ESC to close</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ForensicHelpIcon;
