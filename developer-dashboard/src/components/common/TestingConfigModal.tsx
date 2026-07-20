// ═══════════════════════════════════════════════════════════════
// TestingConfigModal.tsx - CONSOLIDATED PRE-LAUNCH CONFIGURATION
// ═══════════════════════════════════════════════════════════════
// Hosts every setting that is fixed at launch time (infiltration matrix, boundary
// lock, target credentials). Edits write straight through to the caller's state so
// nothing is lost when the dialog closes; the caller keeps owning persistence.

import { useState } from 'react';
import { X, KeyRound, Crosshair } from 'lucide-react';
import { Modal } from '../ui/Modal';
import InfiltrationProfileSelector from './InfiltrationProfileSelector';
import TargetAuthPanel, { isTargetAuthIncomplete, type TargetAuthDraft } from './TargetAuthPanel';
import type { InfiltrationProfileId } from '../../types';

type ConfigTab = 'infiltration' | 'auth';

interface TestingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: InfiltrationProfileId;
  onProfileChange: (next: InfiltrationProfileId) => void;
  strictBoundary: boolean;
  onStrictBoundaryChange: (next: boolean) => void;
  authDraft: TargetAuthDraft;
  onAuthDraftChange: (next: TargetAuthDraft) => void;
}

const TABS: { id: ConfigTab; label: string; icon: typeof Crosshair }[] = [
  { id: 'infiltration', label: 'Infiltration', icon: Crosshair },
  { id: 'auth', label: 'Target Auth', icon: KeyRound },
];

export default function TestingConfigModal({
  isOpen,
  onClose,
  profile,
  onProfileChange,
  strictBoundary,
  onStrictBoundaryChange,
  authDraft,
  onAuthDraftChange,
}: TestingConfigModalProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>('infiltration');
  const authIncomplete = isTargetAuthIncomplete(authDraft);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="testing-config-title"
      maxWidthClassName="max-w-3xl"
      closeOnBackdrop={false}
      backdropClassName="bg-transparent backdrop-blur-[3px]"
    >
      <div className="flex items-center justify-between border-b border-(--border-hairline) px-4 py-3">
        <h3 id="testing-config-title" className="text-sm font-semibold text-(--text-primary)">
          Testing Configuration
        </h3>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center hover:cursor-pointer justify-center rounded-md text-(--text-secondary) hover:bg-(--surface-hover) transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
          aria-label="Close configuration"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="scroll-rail flex border-b border-(--border-hairline) px-2" role="tablist" aria-label="Configuration sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            id={`config-tab-${id}`}
            aria-selected={activeTab === id}
            aria-controls={`config-panel-${id}`}
            onClick={() => setActiveTab(id)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors font-sans ${
              activeTab === id
                ? 'border-(--text-primary) text-(--text-primary)'
                : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            {label}
            {/* Tab-level marker so a blocking auth gap stays visible from the other tab. */}
            {id === 'auth' && authDraft.enabled && (
              <span
                className={`h-1.5 w-1.5 rounded-full ${authIncomplete ? 'bg-(--status-critical-fg)' : 'bg-(--status-stable-fg)'}`}
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>

      <div className="min-h-[240px] p-3 sm:p-4">
        {activeTab === 'infiltration' && (
          <div role="tabpanel" id="config-panel-infiltration" aria-labelledby="config-tab-infiltration" className="space-y-4">
            <InfiltrationProfileSelector profile={profile} onProfileChange={onProfileChange} />
            <label htmlFor="strict-boundary-lock" className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-(--border-hairline) bg-(--surface-raised) px-3 py-2.5">
              <input
                id="strict-boundary-lock"
                type="checkbox"
                checked={strictBoundary}
                onChange={(e) => onStrictBoundaryChange(e.target.checked)}
                className="mt-0.5 rounded border-(--border-strong) text-(--surface-invert) focus:ring-(--border-focus) h-4 w-4"
              />
              <span className="flex flex-col">
                <span className="text-[11px] font-bold tracking-wider text-(--text-secondary) uppercase font-sans">
                  Strict Boundary Lock
                </span>
                <span className="text-[11px] text-(--text-tertiary) font-sans mt-0.5">
                  Confine exploration to the exact target URL — never follow links off it.
                </span>
              </span>
            </label>
          </div>
        )}

        {activeTab === 'auth' && (
          <div role="tabpanel" id="config-panel-auth" aria-labelledby="config-tab-auth">
            <TargetAuthPanel draft={authDraft} onChange={onAuthDraftChange} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-hairline) px-4 py-3">
        <span className="text-[11px] text-(--text-tertiary) font-sans">Applied on the next run.</span>
        <button
          onClick={onClose}
          className="rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) hover:cursor-pointer text-(--text-oninvert) px-4 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
