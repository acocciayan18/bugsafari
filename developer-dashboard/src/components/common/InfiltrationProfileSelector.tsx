// ═══════════════════════════════════════════════════════════════════════════════
// InfiltrationProfileSelector.tsx - Unified Infiltration Profile picker
// Replaces the raw scenario checklist with four named execution profiles. When
// the Custom Strategy Profile is chosen, the individual scenario matrix is
// revealed beneath so the operator can hand-pick strategies.
// ═══════════════════════════════════════════════════════════════════════════════

import { memo } from 'react';
import { INFILTRATION_PROFILE_CATALOG } from '../../types';
import type { InfiltrationProfileId, TestingTypeId } from '../../types';
import TestingTypeSelector from './TestingTypeSelector';

interface InfiltrationProfileSelectorProps {
  profile: InfiltrationProfileId;
  onProfileChange: (next: InfiltrationProfileId) => void;
  customScenarios: TestingTypeId[];
  onCustomScenariosChange: (next: TestingTypeId[]) => void;
  disabled?: boolean;
}

function InfiltrationProfileSelectorImpl({
  profile,
  onProfileChange,
  customScenarios,
  onCustomScenariosChange,
  disabled = false,
}: InfiltrationProfileSelectorProps) {
  const activeProfile = INFILTRATION_PROFILE_CATALOG.find((option) => option.id === profile);
  const isCustom = Boolean(activeProfile?.custom);

  return (
    <div className="w-full bg-white rounded-lg shadow-md p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
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
              className={`flex items-start gap-2 rounded-md border p-2.5 transition-colors ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50'} ${isSelected ? 'border-slate-800 bg-slate-50 ring-1 ring-slate-800' : 'border-slate-200'}`}
            >
              <input
                type="radio"
                name="infiltration-profile"
                checked={isSelected}
                onChange={() => !disabled && onProfileChange(option.id)}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 border-slate-300 text-slate-800 focus:ring-slate-500"
              />
              <span className="flex flex-col">
                <span className="text-xs font-semibold text-slate-700 leading-tight">{option.label}</span>
                <span className="text-[10px] text-slate-400 leading-tight mt-0.5">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      {/* Individual scenario matrix — only for the Custom Strategy Profile. */}
      {isCustom && (
        <div className="border-t border-slate-100 pt-3">
          <TestingTypeSelector
            selected={customScenarios}
            onChange={onCustomScenariosChange}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

export default memo(InfiltrationProfileSelectorImpl);
