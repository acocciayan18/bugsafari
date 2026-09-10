// RadioOptionCard.tsx - single-choice option row shared by the Testing Configuration sections.
// Presentational only; the caller owns selection state and grouping (role=radiogroup).

interface RadioOptionCardProps {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  badge?: string;
  disabled?: boolean;
  title?: string;
}

export function RadioOptionCard({
  label,
  description,
  selected,
  onSelect,
  badge,
  disabled = false,
  title,
}: RadioOptionCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      title={title}
      onClick={() => !disabled && onSelect()}
      className={`flex items-start gap-3 text-left select-none rounded-(--radius-lg) border px-3.5 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      } ${
        selected
          ? 'border-(--text-primary) bg-(--surface-raised)'
          : 'border-(--border-hairline) bg-(--surface-panel) hover:bg-(--surface-hover)'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-(--text-primary)' : 'border-(--border-strong)'}`}
        aria-hidden="true"
      >
        {selected && <span className="h-2 w-2 rounded-full bg-(--text-primary)" />}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="text-body-sm font-medium leading-snug text-(--text-primary) font-sans">{label}</span>
          {badge && (
            <span className="rounded-full border border-(--border-hairline) bg-(--surface-inset) px-1.5 py-0.5 text-micro font-semibold uppercase leading-none tracking-wide text-(--text-secondary) font-sans">
              {badge}
            </span>
          )}
        </span>
        <span className="text-xs leading-relaxed text-(--text-tertiary) font-sans">{description}</span>
      </span>
    </button>
  );
}
