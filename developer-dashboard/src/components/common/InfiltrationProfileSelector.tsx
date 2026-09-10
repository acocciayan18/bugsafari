// ═══════════════════════════════════════════════════════════════════════════════
// InfiltrationProfileSelector.tsx - Unified Infiltration Profile picker
// Presents the named automated execution profiles as a single-choice radio group.
// ═══════════════════════════════════════════════════════════════════════════════

import { memo } from 'react';
import { RadioOptionCard } from '../ui/RadioOptionCard';
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
    // Single-choice radio group, stacked rows to match Navigation and Duration.
    <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Infiltration Matrix">
      {INFILTRATION_PROFILE_CATALOG.map((option) => {
        const isSelected = option.id === profile;
        // Only Chaos Infiltration is selectable; other profiles stay visible but locked.
        const isLocked = option.id !== 'CHAOS_INFILTRATION';
        const isDisabled = disabled || isLocked;
        return (
          <RadioOptionCard
            key={option.id}
            label={option.label}
            description={option.description}
            selected={isSelected}
            disabled={isDisabled}
            title={isLocked ? 'Temporarily unavailable' : option.description}
            badge={isLocked ? 'Locked' : undefined}
            onSelect={() => onProfileChange(option.id)}
          />
        );
      })}
    </div>
  );
}

export default memo(InfiltrationProfileSelectorImpl);
