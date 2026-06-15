/**
 * Chevron Down Icon Component
 * SVG icon for expand/collapse
 */

interface ChevronDownIconProps {
    className?: string;
}

export default function ChevronDownIcon({ className = 'w-5 h-5' }: ChevronDownIconProps) {
    return (
        <svg
            className={className}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
            />
        </svg>
    );
}
