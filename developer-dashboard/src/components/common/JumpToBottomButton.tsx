import { ArrowDown } from 'lucide-react';


interface JumpToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
}

// Floating pin used alongside useStickyScroll to re-engage the scroll lock
export default function JumpToBottomButton({ visible, onClick }: JumpToBottomButtonProps) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-(--border-hairline) bg-(--surface-invert) px-3 py-1.5 text-xs font-semibold text-(--text-oninvert) shadow-lg hover:bg-(--surface-invert-hover) transition-colors"
      aria-label="Jump to newest log entry"
    >
      
      <ArrowDown className="h-4 w-4" />
      Jump to Bottom
    </button>
  );
}
