// ═══════════════════════════════════════════════════════════════════════════════
// TestingTypeSelector.tsx - Operator-gated scenario matrix
// Renders the catalog of selectable testing strategies as a checklist. The
// operator picks one, several, or all modes before launching a run; the choices
// are mapped natively to backend execution gating.
// ═══════════════════════════════════════════════════════════════════════════════

import { memo } from 'react';
import { TESTING_TYPE_CATALOG } from '../../types';
import type { TestingTypeId } from '../../types';

interface TestingTypeSelectorProps {
  selected: TestingTypeId[];
  onChange: (next: TestingTypeId[]) => void;
  disabled?: boolean;
}

function TestingTypeSelectorImpl({ selected, onChange, disabled = false }: TestingTypeSelectorProps) {
  const selectedSet = new Set(selected);

  // Immutable toggle: produce a fresh array rather than mutating in place.
  const toggle = (id: TestingTypeId): void => {
    if (disabled) return;
    const next = selectedSet.has(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
    onChange(next);
  };

  const allSelected = selected.length === TESTING_TYPE_CATALOG.length;

  const toggleAll = (): void => {
    if (disabled) return;
    onChange(allSelected ? [] : TESTING_TYPE_CATALOG.map((option) => option.id));
  };

  return (
    <div className="w-full bg-white rounded-lg shadow-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
          Testing Types
        </span>
        <button
          type="button"
          onClick={toggleAll}
          disabled={disabled}
          className={`text-[10px] font-semibold uppercase tracking-wider rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-1 ${disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {allSelected ? 'Clear All' : 'Select All'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {TESTING_TYPE_CATALOG.map((option) => {
          const isChecked = selectedSet.has(option.id);
          return (
            <label
              key={option.id}
              title={option.description}
              className={`flex items-start gap-2 rounded-md border p-2 transition-colors duration-200 ease-in-out ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-gray-100'} ${isChecked ? 'border-nova-blue bg-blue-50' : 'border-gray-200'}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(option.id)}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-nova-blue focus:ring-nova-blue"
              />
              <span className="flex flex-col">
                <span className="text-xs font-medium text-gray-700 leading-tight">{option.label}</span>
                <span className="text-[10px] text-gray-400 leading-tight mt-0.5">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      {selected.length === 0 && (
        <p className="mt-2 text-[10px] font-semibold text-amber-600 uppercase tracking-wider">
          Select at least one testing type to launch.
        </p>
      )}
    </div>
  );
}

export default memo(TestingTypeSelectorImpl);
