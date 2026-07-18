import { TriangleAlert } from 'lucide-react';

export const WarningIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <TriangleAlert className={className} strokeWidth={1.75} aria-hidden="true" />
);
