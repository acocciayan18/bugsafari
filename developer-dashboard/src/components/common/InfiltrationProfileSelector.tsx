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
    <div className="w-full bg-white rounded-lg shadow-md p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
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
              className={`flex items-start gap-2 rounded-md border p-2.5 transition-colors duration-200 ease-in-out ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-gray-100'} ${isSelected ? 'border-nova-blue bg-blue-50 ring-1 ring-nova-blue' : 'border-gray-200'}`}
            >
              <input
                type="radio"
                name="infiltration-profile"
                checked={isSelected}
                onChange={() => !disabled && onProfileChange(option.id)}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 border-gray-300 text-nova-blue focus:ring-nova-blue"
              />
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-gray-700 leading-tight">{option.label}</span>
                <span className="text-[10px] text-gray-400 leading-tight mt-0.5">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default memo(InfiltrationProfileSelectorImpl);
