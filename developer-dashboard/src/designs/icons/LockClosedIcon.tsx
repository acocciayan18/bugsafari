import { Lock } from 'lucide-react';

export const LockClosedIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <Lock className={className} strokeWidth={1.75} aria-hidden="true" />
);
