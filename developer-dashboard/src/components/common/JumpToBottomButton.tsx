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
      className="absolute bottom-3 right-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full border border-(--border-hairline) bg-(--surface-invert) px-3 py-2 text-[13px] font-semibold text-(--text-oninvert) shadow-lg hover:bg-(--surface-invert-hover) transition-colors sm:py-1.5"
      aria-label="Jump to newest log entry"
    >
      <ArrowDown className="h-4 w-4 shrink-0" />
    </button>
  );
}
