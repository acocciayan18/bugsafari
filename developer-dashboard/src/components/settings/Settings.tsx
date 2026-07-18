// ═══════════════════════════════════════════════════════════════════════════════
// Settings - Application Settings Page
// ═══════════════════════════════════════════════════════════════════════════════
// Single source of truth for all settings state via useUserSettings.
// Guest mode writes to localStorage; authenticated mode syncs with the backend.
// Dark mode is driven by DarkModeContext — toggling immediately applies the
// 'dark' class to <html> and persists via settings storage.

import { useState, useEffect, useRef, memo, type ReactNode } from 'react';
import {
  LoaderCircle,
  Monitor,
  Moon,
  Sun,
  User,
  Lock,
  Eye,
  EyeOff,
  Bell,
  Save,
  Palette,
  ShieldCheck,
  LogOut,
  KeyRound,
  X,
  Mail,
  Hash,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '../../hooks/useAuth';
import { useUserSettings } from '../../hooks/useUserSettings';
import { useDarkMode } from '../../context/DarkModeContext';
import type { ThemeMode } from '../../types';

const ICON_SIZE = 'h-5 w-5';
const ICON_STROKE = 1.75;

function Spinner() {
  return <LoaderCircle className={`${ICON_SIZE} animate-spin`} strokeWidth={ICON_STROKE} aria-hidden="true" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Card shell — every settings group renders inside one of these
// ─────────────────────────────────────────────────────────────────────────────

function SettingsCard({ icon, title, description, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-panel)] shadow-sm">
      <header className="flex items-start gap-3 border-b border-[var(--border-hairline)] px-5 py-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--surface-invert)] text-[var(--text-oninvert)]">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        </div>
      </header>
      <div className="flex-1 px-5 py-5">{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme mode icons + segmented control
// ─────────────────────────────────────────────────────────────────────────────

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
  { mode: 'light', label: 'Light', icon: <Sun className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" /> },
  { mode: 'dark', label: 'Dark', icon: <Moon className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" /> },
  { mode: 'system', label: 'System', icon: <Monitor className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" /> },
];

// Keyboard-accessible 3-way segmented control (role="radiogroup"/"radio")
function ThemeModeControl({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
      {THEME_OPTIONS.map((opt) => {
        const selected = mode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.mode)}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-app)] ${
              selected
                ? 'border-[var(--border-strong)] bg-[var(--surface-invert)] text-[var(--text-oninvert)]'
                : 'border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function PasswordInputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  showPassword,
  onTogglePassword,
  error,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showPassword: boolean;
  onTogglePassword: () => void;
  error?: string;
  autoComplete: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
        {label}
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-[var(--text-tertiary)]">
          <Lock className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </div>
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-[var(--surface-inset)] px-4 py-3 pl-10 pr-10 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:bg-[var(--surface-panel)] focus:outline-none transition-colors ${
            error
              ? 'border-[var(--status-critical-border)] focus:border-[var(--status-critical-fg)]'
              : 'border-[var(--border-hairline)] focus:border-[var(--border-strong)]'
          }`}
          placeholder={placeholder || '••••••••'}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] focus:outline-none"
          onClick={onTogglePassword}
        >
          {showPassword
            ? <EyeOff className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
            : <Eye className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-[var(--status-critical-fg)]">{error}</p>}
    </div>
  );
}

// Memoized toggle switch — keyboard-accessible (Enter + Space)
const ToggleSwitch = memo(function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  icon,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-[var(--text-tertiary)]">{icon}</div>}
        <div>
          <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
          {description && (
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] focus:ring-offset-2 focus:ring-offset-[var(--surface-app)] ${
          checked ? 'bg-[var(--surface-invert)]' : 'bg-[var(--surface-inset)]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--surface-panel)] shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Application Settings Section
// Self-contained: owns its useUserSettings call.
// Bridges settings.theme → DarkModeContext for immediate visual feedback.
// ─────────────────────────────────────────────────────────────────────────────

function ApplicationSettingsSection() {
  const { settings, isSettingsLoading, updateSettings } = useUserSettings();
  const { setMode } = useDarkMode();
  // isSettingsLoading also flips true/false around every per-toggle save, not just the
  // initial fetch — gating the skeleton on that alone would unmount/remount this whole
  // section on every click. Only show the skeleton before the first load ever completes.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!isSettingsLoading) {
      hasLoadedRef.current = true;
    }
  }, [isSettingsLoading]);

  // Sync stored theme to DarkModeContext whenever settings load from backend or localStorage
  useEffect(() => {
    if (!isSettingsLoading) {
      setMode(settings.theme);
    }
  }, [settings.theme, isSettingsLoading, setMode]);

  const handleThemeSelect = async (mode: ThemeMode) => {
    setMode(mode); // Immediate visual feedback — don't wait for the async save
    await updateSettings({ theme: mode });
  };

  const handleBooleanToggle = async (key: 'notifications' | 'autoSave', value: boolean) => {
    await updateSettings({ [key]: value });
  };

  if (isSettingsLoading && !hasLoadedRef.current) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 bg-[var(--surface-inset)] rounded"></div>
        <div className="h-8 bg-[var(--surface-inset)] rounded"></div>
        <div className="h-8 bg-[var(--surface-inset)] rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Theme</span>
        <p className="mt-0.5 mb-2 text-xs text-[var(--text-secondary)]">Choose how BugSafari looks on this device.</p>
        <ThemeModeControl mode={settings.theme} onChange={handleThemeSelect} />
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3 divide-y divide-[var(--border-hairline)]">
        <ToggleSwitch
          checked={settings.notifications}
          onChange={(checked) => handleBooleanToggle('notifications', checked)}
          label="Notifications"
          description="Show desktop notifications"
          icon={<Bell className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
        />

        <ToggleSwitch
          checked={settings.autoSave}
          onChange={(checked) => handleBooleanToggle('autoSave', checked)}
          label="Auto Save"
          description="Automatically save changes"
          icon={<Save className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Security Settings Section
// ─────────────────────────────────────────────────────────────────────────────

function SecuritySettingsSection() {
  const { changePassword, isPasswordChanging, passwordError, clearPasswordSuccess, clearErrors } = useUserSettings();

  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [errors, setErrors] = useState<{ current?: string; new?: string; confirm?: string }>({});
  const [successMessage, setSuccessMessage] = useState('');

  // Clear stale errors from prior visits when this section unmounts
  useEffect(() => {
    return () => clearErrors();
  }, [clearErrors]);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords({ current: false, new: false, confirm: false });
    setErrors({});
    setSuccessMessage('');
    clearPasswordSuccess();
    clearErrors();
  };

  const togglePassword = (field: 'current' | 'new' | 'confirm') => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const validateForm = (): boolean => {
    const newErrors: { current?: string; new?: string; confirm?: string } = {};

    if (!currentPassword) {
      newErrors.current = 'Current password is required';
    }
    if (!newPassword) {
      newErrors.new = 'New password is required';
    } else if (newPassword.length < 8) {
      newErrors.new = 'Password must be at least 8 characters';
    }
    if (!confirmPassword) {
      newErrors.confirm = 'Please confirm your new password';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirm = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    const success = await changePassword(currentPassword, newPassword);
    if (success) {
      setSuccessMessage('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setSuccessMessage('');
        clearPasswordSuccess();
        setIsOpen(false);
      }, 3000);
    }
  };

  const handleCancel = () => {
    resetForm();
    setIsOpen(false);
  };

  return (
    <div>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
        >
          <KeyRound className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Change Password
        </button>
      )}

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
            className="space-y-4 pt-1"
          >
            <PasswordInputField
              id="currentPassword"
              label="Current Password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Enter current password"
              showPassword={showPasswords.current}
              onTogglePassword={() => togglePassword('current')}
              error={errors.current}
              autoComplete="current-password"
            />

            <PasswordInputField
              id="newPassword"
              label="New Password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="Enter new password"
              showPassword={showPasswords.new}
              onTogglePassword={() => togglePassword('new')}
              error={errors.new}
              autoComplete="new-password"
            />

            <PasswordInputField
              id="confirmPassword"
              label="Confirm Password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Confirm new password"
              showPassword={showPasswords.confirm}
              onTogglePassword={() => togglePassword('confirm')}
              error={errors.confirm}
              autoComplete="new-password"
            />

            {successMessage && (
              <div className="p-3 bg-[var(--status-stable-bg)] border border-[var(--status-stable-border)] rounded-lg">
                <p className="text-sm text-[var(--status-stable-fg)]">{successMessage}</p>
              </div>
            )}

            {/* Backend password errors — e.g. "current password incorrect" */}
            {passwordError && (
              <div className="p-3 bg-[var(--status-critical-bg)] border border-[var(--status-critical-border)] rounded-lg">
                <p className="text-sm text-[var(--status-critical-fg)]">{passwordError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={isPasswordChanging}
                className="flex-1 rounded-lg bg-[var(--surface-invert)] px-4 py-3 text-sm font-semibold text-[var(--text-oninvert)] hover:bg-[var(--surface-invert-hover)] active:bg-[var(--surface-invert-active)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 ease-in-out shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
              >
                {isPasswordChanging ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    Updating...
                  </span>
                ) : (
                  'Update Password'
                )}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isPasswordChanging}
                className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] px-4 py-3 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
              >
                <X className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Section
// ─────────────────────────────────────────────────────────────────────────────

function AccountSection() {
  const { user, logout } = useAuth();
  const { profile, isProfileLoading } = useUserSettings();

  const [displayName, setDisplayName] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    if (profile?.name) {
      setDisplayName(profile.name);
      localStorage.setItem('bugsafari_displayName', profile.name);
    } else {
      const stored = localStorage.getItem('bugsafari_displayName');
      if (stored) setDisplayName(stored);
    }
  }, [profile]);

  const handleLogout = () => {
    logout();
    toast.info('Signed out successfully');
  };

  if (isProfileLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-[var(--surface-inset)] rounded w-3/4"></div>
        <div className="h-4 bg-[var(--surface-inset)] rounded w-1/2"></div>
        <div className="h-20 bg-[var(--surface-inset)] rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-inset)]">
          <User className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">
            {displayName || user?.email || 'User'}
          </p>
          <p className="truncate text-xs text-[var(--text-secondary)]">{user?.email}</p>
        </div>
      </div>

      <dl className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)]">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <User className="h-5 w-5 flex-shrink-0 text-[var(--text-tertiary)]" strokeWidth={ICON_STROKE} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <dt className="text-xs text-[var(--text-secondary)]">Display Name</dt>
            <dd className="truncate text-sm text-[var(--text-primary)]">{displayName || '—'}</dd>
          </div>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Mail className="h-5 w-5 flex-shrink-0 text-[var(--text-tertiary)]" strokeWidth={ICON_STROKE} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <dt className="text-xs text-[var(--text-secondary)]">Email</dt>
            <dd className="truncate text-sm text-[var(--text-primary)]">{user?.email || '—'}</dd>
          </div>
        </div>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Hash className="h-5 w-5 flex-shrink-0 text-[var(--text-tertiary)]" strokeWidth={ICON_STROKE} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <dt className="text-xs text-[var(--text-secondary)]">User ID</dt>
            <dd className="truncate font-mono text-xs text-[var(--text-secondary)]">{user?.id || '—'}</dd>
          </div>
        </div>
      </dl>

      <div className="pt-4 border-t border-[var(--border-hairline)]">
        {showLogoutConfirm ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">Are you sure you want to sign out?</p>
            <div className="flex gap-3">
              <button
                onClick={handleLogout}
                className="rounded-lg bg-[var(--status-critical-fg)] px-4 py-2 text-sm font-semibold text-[var(--text-oninvert)] hover:opacity-90 active:opacity-80 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
              >
                Yes, Sign Out
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-4 py-2 text-sm font-semibold text-[var(--status-critical-fg)] hover:opacity-90 transition-colors"
          >
            <LogOut className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
            Sign Out
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Page (root export)
// Session-expiry is handled globally via the 'bugsafari:session-expired'
// CustomEvent in App.tsx — no useUserSettings() call needed here.
// ─────────────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      console.log('[Settings] User not authenticated');
    }
  }, [isAuthenticated]);

  return (
    <div className="flex h-full w-full flex-col bg-[var(--surface-panel)]">
      <header className="flex items-center justify-between border-b border-[var(--border-hairline)] px-6 py-4">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-[var(--text-primary)]">BUGSAFARI</span>
          <span className="mx-3 text-[var(--text-tertiary)]">/</span>
          <span className="text-sm font-semibold text-[var(--text-secondary)]">SETTINGS</span>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-inset)]">
                <User className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={ICON_STROKE} aria-hidden="true" />
              </div>
              <span className="text-xs text-[var(--text-secondary)] hidden md:inline">{user.email}</span>
            </div>
          )}
        </div>
      </header>

      <main className="m-6 mb-0 flex-1 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-app)]">
        <div className="border-b border-[var(--border-hairline)] px-6 py-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">SETTINGS</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Manage your account preferences and application configuration
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2 xl:grid-cols-3">
          <SettingsCard
            icon={<User className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
            title="Account"
            description="Your profile and identity"
          >
            <AccountSection />
          </SettingsCard>

          <SettingsCard
            icon={<ShieldCheck className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
            title="Security"
            description="Password and account protection"
          >
            <SecuritySettingsSection />
          </SettingsCard>

          <SettingsCard
            icon={<Palette className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
            title="Application"
            description="Appearance and behavior"
          >
            <ApplicationSettingsSection />
          </SettingsCard>
        </div>
      </main>

      <footer className="mb-6 px-6">
        <div className="mb-4 flex h-2 gap-1 rounded-full">
          <div className="h-full flex-1 rounded-full bg-gray-700 dark:bg-gray-300" />
          <div className="h-full flex-1 rounded-full bg-gray-200 dark:bg-gray-600" />
          <div className="h-full flex-1 rounded-full bg-gray-200 dark:bg-gray-600" />
          <div className="h-full flex-1 rounded-full bg-gray-200 dark:bg-gray-600" />
          <div className="h-full flex-1 rounded-full bg-gray-200 dark:bg-gray-600" />
        </div>
        <div className="text-center">
          <span className="font-mono text-xs text-gray-400 dark:text-gray-500">
            SETTINGS PANEL - V.8.3.1
          </span>
        </div>
      </footer>
    </div>
  );
}
