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
      className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-lg hover:bg-gray-100 transition-colors dark:border-gray-600 dark:bg-nova-dark dark:text-gray-200 dark:hover:bg-gray-800"
      aria-label="Jump to newest log entry"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
      Jump to Bottom
    </button>
  );
}
