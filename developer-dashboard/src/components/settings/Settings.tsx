// ═══════════════════════════════════════════════════════════════════════════════
// Settings - Application Settings Page
// ═══════════════════════════════════════════════════════════════════════════════
// Single source of truth for all settings state via useUserSettings.
// Guest mode writes to localStorage; authenticated mode syncs with the backend.
// Dark mode is driven by DarkModeContext — toggling immediately applies the
// 'dark' class to <html> and persists via settings storage.

import { useState, useEffect, useRef, memo, type ReactNode } from 'react';
import { LoaderCircle, Monitor, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';

import { UserIcon, LockClosedIcon, EyeIcon, EyeSlashIcon } from '../icons';
import { useAuth } from '../../hooks/useAuth';
import { useUserSettings } from '../../hooks/useUserSettings';
import { useDarkMode } from '../../context/DarkModeContext';
import type { ThemeMode } from '../../types';

function Spinner() {
  return (
    <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme mode icons + segmented control
// ─────────────────────────────────────────────────────────────────────────────

function SunIcon({ className }: { className?: string }) {
  return <Sun className={className} strokeWidth={1.75} aria-hidden="true" />;
}

function MoonIcon({ className }: { className?: string }) {
  return <Moon className={className} strokeWidth={1.75} aria-hidden="true" />;
}

function MonitorIcon({ className }: { className?: string }) {
  return <Monitor className={className} strokeWidth={1.75} aria-hidden="true" />;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: (className: string) => ReactNode }[] = [
  { mode: 'light', label: 'Light', icon: (c) => <SunIcon className={c} /> },
  { mode: 'dark', label: 'Dark', icon: (c) => <MoonIcon className={c} /> },
  { mode: 'system', label: 'System', icon: (c) => <MonitorIcon className={c} /> },
];

// Keyboard-accessible 3-way segmented control (role="radiogroup"/"radio")
function ThemeModeControl({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 py-3">
      {THEME_OPTIONS.map((opt) => {
        const selected = mode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.mode)}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-nova-dark ${
              selected
                ? 'border-nova-blue bg-blue-50 text-nova-blue dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {opt.icon('h-4 w-4')}
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
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 dark:text-gray-500">
          <LockClosedIcon />
        </div>
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-gray-100 dark:bg-gray-700 px-4 py-3 pl-10 pr-10 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:bg-white dark:focus:bg-gray-600 focus:outline-none transition-colors ${
            error
              ? 'border-red-300 focus:border-red-500'
              : 'border-gray-200 dark:border-gray-600 focus:border-gray-400 dark:focus:border-gray-500'
          }`}
          placeholder={placeholder || '••••••••'}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none"
          onClick={onTogglePassword}
        >
          {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// Memoized toggle switch — keyboard-accessible (Enter + Space)
const ToggleSwitch = memo(function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        )}
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
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-nova-blue focus:ring-offset-2 dark:focus:ring-offset-nova-dark ${
          checked ? 'bg-nova-blue' : 'bg-gray-200 dark:bg-gray-600'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
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
      <div className="space-y-2 max-w-md">
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-md">
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Configure your application preferences. Theme changes apply immediately.
      </p>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Theme</span>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Choose how BugSafari looks on this device.</p>
      </div>

      <ThemeModeControl mode={settings.theme} onChange={handleThemeSelect} />

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Features</span>
      </div>

      <ToggleSwitch
        checked={settings.notifications}
        onChange={(checked) => handleBooleanToggle('notifications', checked)}
        label="Notifications"
        description="Show desktop notifications"
      />

      <ToggleSwitch
        checked={settings.autoSave}
        onChange={(checked) => handleBooleanToggle('autoSave', checked)}
        label="Auto Save"
        description="Automatically save changes"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Implemented sections only
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_SECTIONS = [
  {
    id: 'account',
    label: 'Account Settings',
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    id: 'security',
    label: 'Security Settings',
    icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  },
  {
    id: 'application',
    label: 'Application Settings',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Security Settings Section
// ─────────────────────────────────────────────────────────────────────────────

function SecuritySettingsSection() {
  const { changePassword, isPasswordChanging, passwordError, clearPasswordSuccess, clearErrors } = useUserSettings();

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
      }, 3000);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-5 max-w-md">
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Change your account password. Make sure to use a strong, unique password.
      </p>

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
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-600">{successMessage}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isPasswordChanging}
        className="w-full rounded-lg bg-nova-blue px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 ease-in-out shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
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

      {/* Backend password errors — e.g. "current password incorrect" */}
      {passwordError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{passwordError}</p>
        </div>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingsSection accordion wrapper
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ icon, label, isExpanded, onToggle }: {
  icon: string;
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
          <svg className="h-5 w-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</span>
      </div>
      <svg
        className={`h-5 w-5 text-gray-400 dark:text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function SettingsSection({
  id,
  label,
  icon,
  isExpanded,
  onToggle,
}: {
  id: string;
  label: string;
  icon: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const contentMap: Record<string, React.ReactNode> = {
    account: <AccountSection />,
    security: <SecuritySettingsSection />,
    application: <ApplicationSettingsSection />,
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      <SectionHeader icon={icon} label={label} isExpanded={isExpanded} onToggle={onToggle} />
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-6 py-8">
          {contentMap[id] ?? null}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Section
// ─────────────────────────────────────────────────────────────────────────────

function AccountSection() {
  const { user, logout } = useAuth();
  const { profile, isProfileLoading, updateProfile, isProfileUpdating, profileUpdateError } = useUserSettings();

  const [displayName, setDisplayName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
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

  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      toast.error('Display name cannot be empty');
      return;
    }
    const success = await updateProfile({ name: displayName.trim() });
    if (success) {
      setSuccessMessage('Profile updated successfully');
      setIsEditing(false);
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  const handleLogout = () => {
    logout();
    toast.info('Signed out successfully');
  };

  if (isProfileLoading) {
    return (
      <div className="space-y-4 max-w-md">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-md">
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Manage your account information and preferences.
      </p>

      <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-600">
            <UserIcon />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {profile?.name || user?.email || 'User'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{user?.email}</p>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
          <p className="text-xs text-gray-500 dark:text-gray-400">User ID</p>
          <p className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">{user?.id}</p>
        </div>
      </div>

      <div className="space-y-3">
        <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Display Name
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={!isEditing}
          className="w-full rounded-lg border bg-gray-100 dark:bg-gray-700 px-4 py-3 text-sm text-gray-800 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-600 focus:outline-none border-gray-200 dark:border-gray-600 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500 dark:disabled:text-gray-400"
          placeholder="Enter your display name"
        />

        {profileUpdateError && (
          <p className="text-xs text-red-500">{profileUpdateError}</p>
        )}

        {successMessage && (
          <p className="text-sm text-green-600">{successMessage}</p>
        )}

        <div className="flex gap-3">
          {isEditing ? (
            <>
              <button
                onClick={handleSaveProfile}
                disabled={isProfileUpdating}
                className="flex-1 rounded-lg bg-nova-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
              >
                {isProfileUpdating ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    Saving...
                  </span>
                ) : 'Save'}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setDisplayName(profile?.name || '');
                }}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
            >
              Edit Profile
            </button>
          )}
        </div>
      </div>

      <div className="pt-4 border-t border-gray-200 dark:border-gray-600">
        {showLogoutConfirm ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">Are you sure you want to sign out?</p>
            <div className="flex gap-3">
              <button
                onClick={handleLogout}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 active:bg-red-700 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
              >
                Yes, Sign Out
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 transition-colors"
          >
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
  const [expandedSection, setExpandedSection] = useState<string | null>('account');

  useEffect(() => {
    if (!isAuthenticated) {
      console.log('[Settings] User not authenticated');
    }
  }, [isAuthenticated]);

  const toggleSection = (sectionId: string) => {
    setExpandedSection(expandedSection === sectionId ? null : sectionId);
  };

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-slate-900">
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-gray-900 dark:text-gray-100">BUGSAFARI</span>
          <span className="mx-3 text-gray-400 dark:text-gray-500">/</span>
          <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">SETTINGS</span>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                <UserIcon />
              </div>
              <span className="text-xs text-gray-600 dark:text-gray-400 hidden md:inline">{user.email}</span>
            </div>
          )}
        </div>
      </header>

      <main className="m-6 mb-0 flex-1 overflow-auto rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">SETTINGS</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage your account preferences and application configuration
          </p>
        </div>

        <div className="p-6 space-y-4">
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsSection
              key={section.id}
              id={section.id}
              label={section.label}
              icon={section.icon}
              isExpanded={expandedSection === section.id}
              onToggle={() => toggleSection(section.id)}
            />
          ))}
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
