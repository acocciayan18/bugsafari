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
    <div className="w-full flex flex-col gap-2">
      <span className="text-xs font-bold r text-(--text-secondary) uppercase font-sans">
        Infiltration Matrix
      </span>

      {/* Profile cards — single-choice radio group, styled to match Navigation Boundary. */}
      {/* Column counts track the catalog size — a 4-up grid left the fifth card orphaned on its own row. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2" role="radiogroup" aria-label="Infiltration Matrix">
        {INFILTRATION_PROFILE_CATALOG.map((option) => {
          const isSelected = option.id === profile;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              title={option.description}
              onClick={() => !disabled && onProfileChange(option.id)}
              className={`flex items-start gap-2.5 text-left rounded-lg border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) ${
                disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
              } ${
                isSelected
                  ? 'border-(--text-primary) bg-(--surface-raised)'
                  : 'border-(--border-hairline) bg-(--surface-base) hover:bg-(--surface-hover)'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-(--text-primary)' : 'border-(--border-strong)'}`}
                aria-hidden="true"
              >
                {isSelected && <span className="h-2 w-2 rounded-full bg-(--text-primary)" />}
              </span>
              <span className="flex flex-col">
                <span className="text-xs font-bold r text-(--text-secondary) uppercase font-sans">{option.label}</span>
                <span className="text-xs text-(--text-tertiary) font-sans mt-0.5 leading-tight">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(InfiltrationProfileSelectorImpl);
