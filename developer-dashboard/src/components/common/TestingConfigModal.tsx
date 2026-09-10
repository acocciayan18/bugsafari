// ═══════════════════════════════════════════════════════════════
// TestingConfigModal.tsx - CONSOLIDATED PRE-LAUNCH CONFIGURATION
// ═══════════════════════════════════════════════════════════════
// Hosts every setting that is fixed at launch time (infiltration matrix, boundary
// lock, target credentials). Edits write straight through to the caller's state so
// nothing is lost when the dialog closes; the caller keeps owning persistence.

import { useEffect, useState } from 'react';
import { X, KeyRound, Crosshair, Route, Timer } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { RadioOptionCard } from '../ui/RadioOptionCard';
import { useAuth } from '../../context/AuthContext';
import InfiltrationProfileSelector from './InfiltrationProfileSelector';
import TargetAuthPanel, { isTargetAuthIncomplete, type TargetAuthDraft } from './TargetAuthPanel';
import { TEST_DURATION_PRESETS, type BoundaryLockMode, type InfiltrationProfileId, type TestDurationId } from '../../types';

// Guests are capped at the 5-minute preset; the backend clamp is the authority.
const GUEST_DURATION_ID: TestDurationId = '5m';

type ConfigTab = 'infiltration' | 'boundary' | 'duration' | 'auth';

interface TestingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: InfiltrationProfileId;
  onProfileChange: (next: InfiltrationProfileId) => void;
  boundaryMode: BoundaryLockMode;
  onBoundaryModeChange: (next: BoundaryLockMode) => void;
  duration: TestDurationId;
  onDurationChange: (next: TestDurationId) => void;
  authDraft: TargetAuthDraft;
  onAuthDraftChange: (next: TargetAuthDraft) => void;
}

// Section metadata drives the nav rail and each panel header from one source.
const TABS: { id: ConfigTab; label: string; hint: string; title: string; blurb: string; icon: typeof Crosshair }[] = [
  {
    id: 'infiltration',
    label: 'Infiltration',
    hint: 'Exploration behaviour',
    title: 'Infiltration matrix',
    blurb: 'How aggressively the engine interacts with the target.',
    icon: Crosshair,
  },
  {
    id: 'boundary',
    label: 'Navigation',
    hint: 'How far it roams',
    title: 'Navigation boundary',
    blurb: 'The furthest the engine may navigate from your target URL.',
    icon: Route,
  },
  {
    id: 'duration',
    label: 'Duration',
    hint: 'Run time limit',
    title: 'Test duration',
    blurb: 'When the engine stops once the run is under way.',
    icon: Timer,
  },
  {
    id: 'auth',
    label: 'Target Auth',
    hint: 'Sign in to the target',
    title: 'Target authentication',
    blurb: 'Optional test account so exploration reaches pages behind a login.',
    icon: KeyRound,
  },
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
  duration,
  onDurationChange,
  authDraft,
  onAuthDraftChange,
}: TestingConfigModalProps) {
  const { isGuestMode } = useAuth();
  const [activeTab, setActiveTab] = useState<ConfigTab>('infiltration');
  const authIncomplete = isTargetAuthIncomplete(authDraft);

  // Guests: Target Auth is disabled and the duration is pinned to 5 minutes.
  const tabs = isGuestMode ? TABS.filter((tab) => tab.id !== 'auth') : TABS;
  const durationPresets = isGuestMode
    ? TEST_DURATION_PRESETS.filter((preset) => preset.id === GUEST_DURATION_ID)
    : TEST_DURATION_PRESETS;
  useEffect(() => {
    if (isGuestMode && duration !== GUEST_DURATION_ID) onDurationChange(GUEST_DURATION_ID);
    if (isGuestMode && activeTab === 'auth') setActiveTab('infiltration');
  }, [isGuestMode, duration, onDurationChange, activeTab]);

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="testing-config-title"
      maxWidthClassName="max-w-3xl"
      closeOnBackdrop={false}
      backdropClassName="bg-transparent backdrop-blur-[3px]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-(--border-hairline) px-5 py-4">
        <div className="min-w-0">
          <h3 id="testing-config-title" className="text-sm font-semibold leading-snug text-(--text-primary) font-sans">
            Testing Configuration
          </h3>
          <p className="mt-1 text-xs leading-normal text-(--text-tertiary) font-sans">
            Fixed at launch and applied on your next run.
          </p>
        </div>
        <button
          onClick={onClose}
          className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center hover:cursor-pointer justify-center rounded-md text-(--text-secondary) hover:bg-(--surface-hover) transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
          aria-label="Close configuration"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Sidebar rail on sm+, horizontal strip on mobile. Same items, one active-pill treatment. */}
      <div className="flex flex-col sm:flex-row sm:min-h-[440px]">
        <nav
          className="scroll-rail flex shrink-0 gap-1 overflow-x-auto border-b border-(--border-hairline) p-2 sm:w-56 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3"
          role="tablist"
          aria-label="Configuration sections"
        >
          {tabs.map(({ id, label, hint, icon: Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                role="tab"
                id={`config-tab-${id}`}
                aria-selected={selected}
                aria-controls="config-active-panel"
                onClick={() => setActiveTab(id)}
                className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-(--radius-md) px-3 py-2.5 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) sm:whitespace-normal ${
                  selected
                    ? 'bg-(--surface-hover) text-(--text-primary)'
                    : 'text-(--text-tertiary) hover:bg-(--surface-hover) hover:text-(--text-secondary)'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-body-sm font-medium leading-snug font-sans">
                    {label}
                    {/* Auth gap stays visible while another section is open. */}
                    {id === 'auth' && authDraft.enabled && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${authIncomplete ? 'bg-(--status-critical-fg)' : 'bg-(--status-stable-fg)'}`}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="hidden text-xs leading-normal text-(--text-tertiary) font-sans sm:block">{hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Fixed height + inner scroll so the modal never resizes or shifts between sections. */}
        <div
          id="config-active-panel"
          role="tabpanel"
          aria-labelledby={`config-tab-${active.id}`}
          className="custom-scrollbar min-w-0 flex-1 overflow-y-auto p-5 sm:max-h-[440px]"
        >
          <div className="mb-5">
            <h4 className="text-body-sm font-semibold leading-snug text-(--text-primary) font-sans">{active.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-(--text-tertiary) font-sans">
              {activeTab === 'duration' && isGuestMode
                ? 'Guest runs are capped at 5 minutes. Sign in for longer runs.'
                : active.blurb}
            </p>
          </div>

          {activeTab === 'infiltration' && (
            <InfiltrationProfileSelector profile={profile} onProfileChange={onProfileChange} />
          )}

          {activeTab === 'boundary' && (
            <div role="radiogroup" aria-label="Navigation boundary" className="flex flex-col gap-2.5">
              {BOUNDARY_OPTIONS.map(({ id, label, description }) => (
                <RadioOptionCard
                  key={id}
                  label={label}
                  description={description}
                  selected={boundaryMode === id}
                  onSelect={() => onBoundaryModeChange(id)}
                  badge={id === 'site' ? 'Recommended' : undefined}
                />
              ))}
            </div>
          )}

          {activeTab === 'duration' && (
            <div role="radiogroup" aria-label="Test duration" className="flex flex-col gap-2.5">
              {durationPresets.map(({ id, label, sublabel }) => (
                <RadioOptionCard
                  key={id}
                  label={label}
                  description={sublabel}
                  selected={duration === id}
                  onSelect={() => onDurationChange(id)}
                  badge={id === '10m' ? 'Recommended' : undefined}
                />
              ))}
            </div>
          )}

          {activeTab === 'auth' && !isGuestMode && (
            <TargetAuthPanel draft={authDraft} onChange={onAuthDraftChange} />
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-(--border-hairline) bg-(--surface-panel) px-5 py-3.5">
        <span className="text-xs leading-normal text-(--text-tertiary) font-sans">
          {authDraft.enabled && authIncomplete
            ? 'Target Auth needs a username and password before it runs.'
            : 'Changes are saved as you edit.'}
        </span>
        <button
          onClick={onClose}
          className="rounded-lg bg-(--surface-invert) px-6 py-2 text-xs font-bold uppercase text-(--text-oninvert) transition-colors hover:cursor-pointer hover:bg-(--surface-invert-hover)"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
