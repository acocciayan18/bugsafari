interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-controls'?: string;
  // Ring-offset surface tailored to the panel the switch sits on (defaults to the app surface).
  className?: string;
}

/** On/off toggle control — the bare switch; wrap it with a label row where one is needed. */
export function Switch({ checked, onChange, disabled = false, className = '', ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-(--border-focus) focus:ring-offset-2 focus:ring-offset-(--surface-app) disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-pointer ${
        checked ? 'border-(--accent) bg-(--accent)' : 'border-(--border-strong) bg-(--surface-hover)'
      } ${className}`}
      {...aria}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-(--shadow-sm) ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
