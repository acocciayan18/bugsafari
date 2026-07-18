import { User } from 'lucide-react';

export const UserIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <User className={className} strokeWidth={1.75} aria-hidden="true" />
);
