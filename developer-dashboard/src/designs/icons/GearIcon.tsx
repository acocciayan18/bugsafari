import { Settings } from 'lucide-react';

export const GearIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <Settings className={className} strokeWidth={1.75} aria-hidden="true" />
);
