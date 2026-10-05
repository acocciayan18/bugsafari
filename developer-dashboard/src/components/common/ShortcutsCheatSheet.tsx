import { Modal } from '../ui/Modal';
import { Keyboard } from 'lucide-react';

interface ShortcutsCheatSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

// Keep in lockstep with useDashboardShortcuts — this is the only user-facing listing.
const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['/', 'U'], label: 'Focus the target URL field' },
  { keys: ['S'], label: 'Start or stop the run' },
  { keys: ['C'], label: 'Open testing configuration' },
  { keys: ['1', '2', '3', '4'], label: 'Telemetry / Findings / Network / Console' },
  { keys: ['?'], label: 'Toggle this shortcut sheet' },
  { keys: ['Esc'], label: 'Close any open overlay' },
];

// `?` overlay listing the dashboard's keyboard shortcuts.
export default function ShortcutsCheatSheet({ isOpen, onClose }: ShortcutsCheatSheetProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="shortcuts-title">
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--surface-inset)">
            <Keyboard className="h-5 w-5 shrink-0 text-(--text-secondary)" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <h2 id="shortcuts-title" className="text-base sm:text-lg font-semibold text-(--text-primary)">
            Keyboard shortcuts
          </h2>
        </div>

        <ul className="flex flex-col divide-y divide-(--border-hairline)">
          {SHORTCUTS.map(({ keys, label }) => (
            <li key={label} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-(--text-secondary)">{label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-[1.6rem] rounded-md border border-(--border-strong) bg-(--surface-raised) px-1.5 py-0.5 text-center font-mono text-[12px] font-semibold text-(--text-primary)"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
