// ═══════════════════════════════════════════════════════════════════════════════
// InfiltrationProfileSelector.tsx - Unified Infiltration Profile picker
// Presents the named automated execution profiles as a single-choice radio group.
// ═══════════════════════════════════════════════════════════════════════════════

import { memo } from 'react';
import { INFILTRATION_PROFILE_CATALOG } from '../../types';
import type { InfiltrationProfileId } from '../../types';

interface InfiltrationProfileSelectorProps {
  profile: InfiltrationProfileId;
  onProfileChange: (next: InfiltrationProfileId) => void;
  disabled?: boolean;
}

function InfiltrationProfileSelectorImpl({
  profile,
  onProfileChange,
  disabled = false,
}: InfiltrationProfileSelectorProps) {
  return (
    <div className="w-full bg-[var(--surface-panel)] rounded-lg shadow-md p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
          Infiltration Profile
        </span>
      </div>

      {/* Profile cards — single-choice radio group, responsive grid. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2" role="radiogroup" aria-label="Infiltration Profile">
        {INFILTRATION_PROFILE_CATALOG.map((option) => {
          const isSelected = option.id === profile;
          return (
            <label
              key={option.id}
              title={option.description}
              className={`flex items-start gap-2 rounded-md border p-2.5 transition-colors duration-200 ease-in-out ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-[var(--surface-hover)]'} ${isSelected ? 'border-[var(--border-strong)] bg-[var(--surface-invert)]' : 'border-[var(--border-hairline)]'}`}
            >
              <input
                type="radio"
                name="infiltration-profile"
                checked={isSelected}
                onChange={() => !disabled && onProfileChange(option.id)}
                disabled={disabled}
                className="mt-0.5 h-5 w-5 border-[var(--border-strong)] text-[var(--surface-invert)] focus:ring-[var(--border-focus)]"
              />
              <span className="flex flex-col">
                <span className={`text-xs font-semibold leading-tight ${isSelected ? 'text-[var(--text-oninvert)]' : 'text-[var(--text-secondary)]'}`}>{option.label}</span>
                <span className={`text-[10px] leading-tight mt-0.5 ${isSelected ? 'text-[var(--text-oninvert)] opacity-80' : 'text-[var(--text-tertiary)]'}`}>{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default memo(InfiltrationProfileSelectorImpl);
