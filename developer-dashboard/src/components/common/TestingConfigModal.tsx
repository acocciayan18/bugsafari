// ═══════════════════════════════════════════════════════════════
// TestingConfigModal.tsx - CONSOLIDATED PRE-LAUNCH CONFIGURATION
// ═══════════════════════════════════════════════════════════════
// Hosts every setting that is fixed at launch time (infiltration matrix, boundary
// lock, target credentials). Edits write straight through to the caller's state so
// nothing is lost when the dialog closes; the caller keeps owning persistence.

import { useState } from 'react';
import { X, KeyRound, Crosshair, Route } from 'lucide-react';
import { Modal } from '../ui/Modal';
import InfiltrationProfileSelector from './InfiltrationProfileSelector';
import TargetAuthPanel, { isTargetAuthIncomplete, type TargetAuthDraft } from './TargetAuthPanel';
import type { BoundaryLockMode, InfiltrationProfileId } from '../../types';

type ConfigTab = 'infiltration' | 'boundary' | 'auth';

interface TestingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: InfiltrationProfileId;
  onProfileChange: (next: InfiltrationProfileId) => void;
  boundaryMode: BoundaryLockMode;
  onBoundaryModeChange: (next: BoundaryLockMode) => void;
  authDraft: TargetAuthDraft;
  onAuthDraftChange: (next: TargetAuthDraft) => void;
}

const TABS: { id: ConfigTab; label: string; icon: typeof Crosshair }[] = [
  { id: 'infiltration', label: 'Infiltration', icon: Crosshair },
  { id: 'boundary', label: 'Navigation', icon: Route },
  { id: 'auth', label: 'Target Auth', icon: KeyRound },
];

const BOUNDARY_OPTIONS: { id: BoundaryLockMode; label: string; description: string }[] = [
  {
    id: 'exact',
    label: 'Exact URL',
    description: 'Limit exploration to the configured target URL. Any navigation beyond the target site is blocked.',
  },
  {
    id: 'subtree',
    label: 'Sub-Tree / Prefix Lock',
    description: 'Restricts exploration to the selected feature by allowing navigation only within the target route and its descendant pages.',
  },
  {
    id: 'site',
    label: 'Whole Site',
    description: 'Allows exploration across the target host, its subdomains, and trusted authentication origins.',
  },
];

export default function TestingConfigModal({
  isOpen,
  onClose,
  profile,
  onProfileChange,
  boundaryMode,
  onBoundaryModeChange,
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
        <h3 id="testing-config-title" className="text-[13px] font-semibold text-(--text-primary)">
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
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-bold uppercase r transition-colors font-sans ${
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
          </div>
        )}

        {activeTab === 'boundary' && (
          <div role="tabpanel" id="config-panel-boundary" aria-labelledby="config-tab-boundary">
            <div role="radiogroup" aria-label="Navigation boundary" className="flex flex-col gap-2">
              <span className="text-xs font-bold r text-(--text-secondary) uppercase font-sans">
                Navigation Boundary
              </span>
              {BOUNDARY_OPTIONS.map(({ id, label, description }) => {
                const selected = boundaryMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onBoundaryModeChange(id)}
                    className={`flex items-start gap-2.5 text-left cursor-pointer select-none rounded-lg border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) ${
                      selected
                        ? 'border-(--text-primary) bg-(--surface-raised)'
                        : 'border-(--border-hairline) bg-(--surface-base) hover:bg-(--surface-hover)'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-(--text-primary)' : 'border-(--border-strong)'}`}
                      aria-hidden="true"
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-(--text-primary)" />}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-xs font-bold r text-(--text-secondary) uppercase font-sans">
                        {label}
                        {id === 'subtree' && (
                          <span className="ml-1.5 lowercase text-(--text-tertiary) font-medium">(recommended)</span>
                        )}
                      </span>
                      <span className="text-xs text-(--text-tertiary) font-sans mt-0.5">{description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'auth' && (
          <div role="tabpanel" id="config-panel-auth" aria-labelledby="config-tab-auth">
            <TargetAuthPanel draft={authDraft} onChange={onAuthDraftChange} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-hairline) px-4 py-3">
        <span className="text-xs text-(--text-tertiary) font-sans">Applied on the next run.</span>
        <button
          onClick={onClose}
          className="rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) hover:cursor-pointer text-(--text-oninvert) px-4 py-2 text-xs font-bold uppercase r transition-colors"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
