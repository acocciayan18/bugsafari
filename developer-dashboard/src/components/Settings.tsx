// ═══════════════════════════════════════════════════════════════════════════════
// Settings - Application Settings Page (Phase 4 - Performance Optimized)
// ═══════════════════════════════════════════════════════════════════════════════
// This component integrates with useAuth and useUserSettings hooks for
// real backend authentication and settings management.
// Phase 4: Added memoization and accessibility improvements.

import { useState, useEffect, memo } from 'react';
import { toast } from 'sonner';

// Icons - use extracted components
import { UserIcon, LockClosedIcon, EyeIcon, EyeSlashIcon } from './icons';

// Hooks
import { useAuth } from '../hooks/useAuth';
import { useUserSettings } from '../hooks/useUserSettings';

// Password input field component with show/hide toggle
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
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-2">
        {label}
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
          <LockClosedIcon />
        </div>
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-slate-50 px-4 py-3 pl-10 pr-10 text-sm text-slate-800 placeholder-slate-300 focus:bg-white focus:outline-none transition-colors ${error ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-slate-400'
            }`}
          placeholder={placeholder || '••••••••'}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
          onClick={onTogglePassword}
        >
          {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// Toggle Switch component - memoized for performance (Phase 4)
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
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 ${checked ? 'bg-slate-800' : 'bg-slate-200'
          }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'
            }`}
        />
      </button>
    </div>
  );
});

// Application Settings Section with toggles (UI-only - static defaults)
function ApplicationSettingsSection() {
  // UI-only: Use local state for display purposes
  const [darkMode, setDarkMode] = useState(false);
  const [lightMode, setLightMode] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [autoSave, setAutoSave] = useState(true);

  return (
    <div className="space-y-2 max-w-md">
      <p className="text-sm text-slate-600 mb-4">
        Configure your application preferences. Theme changes apply immediately.
      </p>

      <div className="border-t border-slate-200 pt-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Theme</span>
      </div>

      <ToggleSwitch
        checked={darkMode}
        onChange={setDarkMode}
        label="Dark Mode"
        description="Use dark color scheme"
      />

      <ToggleSwitch
        checked={lightMode}
        onChange={setLightMode}
        label="Light Mode"
        description="Use light color scheme"
      />

      <div className="border-t border-slate-200 pt-4 mt-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Features</span>
      </div>

      <ToggleSwitch
        checked={notifications}
        onChange={setNotifications}
        label="Notifications"
        description="Show desktop notifications"
      />

      <ToggleSwitch
        checked={autoSave}
        onChange={setAutoSave}
        label="Auto Save"
        description="Automatically save changes"
      />
    </div>
  );
}

// Section configuration
const SETTINGS_SECTIONS = [
  { id: 'account', label: 'Account Settings', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { id: 'security', label: 'Security Settings', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
  { id: 'application', label: 'Application Settings', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'bugsafari', label: 'BugSafari Settings', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2zM5 21h14a1 1 0 001-1v-4a1 1 0 00-1-1H5a1 1 0 00-1 1v4a1 1 0 001 1z' },
  { id: 'data', label: 'Data & Storage', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4' },
  { id: 'system', label: 'System Information', icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
  { id: 'danger', label: 'Danger Zone', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
];

// Security Settings Section with password change form - connected to backend
function SecuritySettingsSection() {
  const { changePassword, isPasswordChanging, passwordError, clearPasswordSuccess } = useUserSettings();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [errors, setErrors] = useState<{ current?: string; new?: string; confirm?: string }>({});
  const [successMessage, setSuccessMessage] = useState('');

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
    if (!validateForm()) {
      return;
    }

    // Call backend to change password
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
      <div>
        <p className="text-sm text-slate-600 mb-4">
          Change your account password. Make sure to use a strong, unique password.
        </p>
      </div>

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
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <p className="text-sm text-emerald-600">{successMessage}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isPasswordChanging}
        className="w-full rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-md"
      >
        {isPasswordChanging ? 'Updating...' : 'Update Password'}
      </button>
    </form>
  );
}

// Section component for consistent rendering
function SettingsSection({
  id,
  label,
  icon,
  isExpanded,
  onToggle
}: {
  id: string;
  label: string;
  icon: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Render account section with user profile
  if (isExpanded && id === 'account') {
    return (
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
              <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-900">{label}</span>
          </div>
          <svg
            className={`h-5 w-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-8">
          <AccountSection />
        </div>
      </div>
    );
  }

  // Render security section with password change form
  if (isExpanded && id === 'security') {
    return (
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
              <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-900">{label}</span>
          </div>
          <svg
            className={`h-5 w-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-8">
          <SecuritySettingsSection />
        </div>
      </div>
    );
  }

  // Render application section with connected toggles
  if (isExpanded && id === 'application') {
    return (
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
              <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-900">{label}</span>
          </div>
          <svg
            className={`h-5 w-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-8">
          <ApplicationSettingsSection />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
            <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-900">{label}</span>
        </div>
        <svg
          className={`h-5 w-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-8">
          <div className="flex flex-col items-center justify-center gap-3 py-4">
            <svg className="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
            <span className="text-sm text-slate-500">{label} - Coming Soon</span>
            <span className="text-xs text-slate-400">This section is not yet implemented</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Account Section - displays user info from useAuth and useUserSettings
function AccountSection() {
  const { user, logout } = useAuth();
  const { profile, isProfileLoading, updateProfile, isProfileUpdating, profileUpdateError } = useUserSettings();

  const [displayName, setDisplayName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Initialize display name from profile
  useEffect(() => {
    if (profile?.name) {
      setDisplayName(profile.name);
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
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
          <div className="h-20 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-md">
      <p className="text-sm text-slate-600 mb-4">
        Manage your account information and preferences.
      </p>

      {/* User Info Display */}
      <div className="bg-slate-50 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200">
            <UserIcon />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">
              {profile?.name || user?.email || 'User'}
            </p>
            <p className="text-xs text-slate-500">{user?.email}</p>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200">
          <p className="text-xs text-slate-500">User ID</p>
          <p className="text-xs font-mono text-slate-700 truncate">{user?.id}</p>
        </div>
      </div>

      {/* Profile Update Form */}
      <div className="space-y-3">
        <label htmlFor="displayName" className="block text-sm font-medium text-slate-700">
          Display Name
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={!isEditing}
          className="w-full rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-800 focus:bg-white focus:outline-none border-slate-200 disabled:bg-slate-100 disabled:text-slate-500"
          placeholder="Enter your display name"
        />

        {profileUpdateError && (
          <p className="text-xs text-red-500">{profileUpdateError}</p>
        )}

        {successMessage && (
          <p className="text-sm text-emerald-600">{successMessage}</p>
        )}

        <div className="flex gap-3">
          {isEditing ? (
            <>
              <button
                onClick={handleSaveProfile}
                disabled={isProfileUpdating}
                className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {isProfileUpdating ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setDisplayName(profile?.name || '');
                }}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Edit Profile
            </button>
          )}
        </div>
      </div>

      {/* Logout Button */}
      <div className="pt-4 border-t border-slate-200">
        <button
          onClick={handleLogout}
          className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  // Integrate useAuth hook
  const { user, isAuthenticated, logout } = useAuth();
  const { settings, isSettingsLoading, updateSettings } = useUserSettings();

  // Local state for expanded section tracking
  const [expandedSection, setExpandedSection] = useState<string | null>('account');

  // Check authentication on mount and handle unauthenticated state
  useEffect(() => {
    if (!isAuthenticated()) {
      // User is not authenticated - could redirect to login
      console.log('[Settings] User not authenticated');
    }
  }, [user]);

  // Handle application settings toggle with backend integration
  const handleSettingsToggle = async (key: 'notifications' | 'autoSave', value: boolean) => {
    await updateSettings({ [key]: value });
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSection(expandedSection === sectionId ? null : sectionId);
  };

  // Custom ApplicationSettingsSection with backend integration
  function ConnectedApplicationSettingsSection() {
    if (isSettingsLoading) {
      return (
        <div className="space-y-2 max-w-md">
          <div className="animate-pulse space-y-3">
            <div className="h-8 bg-slate-200 rounded"></div>
            <div className="h-8 bg-slate-200 rounded"></div>
            <div className="h-8 bg-slate-200 rounded"></div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2 max-w-md">
        <p className="text-sm text-slate-600 mb-4">
          Configure your application preferences. Theme changes apply immediately.
        </p>

        <div className="border-t border-slate-200 pt-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Theme</span>
        </div>

        <ToggleSwitch
          checked={settings.theme === 'light'}
          onChange={() => { }}
          label="Light Mode"
          description="Use light color scheme"
        />

        <div className="border-t border-slate-200 pt-4 mt-4">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Features</span>
        </div>

        <ToggleSwitch
          checked={settings.notifications}
          onChange={(checked) => handleSettingsToggle('notifications', checked)}
          label="Notifications"
          description="Show desktop notifications"
        />

        <ToggleSwitch
          checked={settings.autoSave}
          onChange={(checked) => handleSettingsToggle('autoSave', checked)}
          label="Auto Save"
          description="Automatically save changes"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-slate-900">
            BUGSAFARI
          </span>
          <span className="mx-3 text-slate-400">/</span>
          <span className="text-sm font-semibold text-slate-600">
            SETTINGS
          </span>
        </div>
        <div className="flex items-center gap-4">
          {/* User info in header */}
          {user && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
                <UserIcon />
              </div>
              <span className="text-xs text-slate-600 hidden md:inline">{user.email}</span>
            </div>
          )}
          <button
            onClick={logout}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
            title="Sign Out"
          >
            <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="m-6 mb-0 flex-1 overflow-auto rounded-md border border-slate-300 bg-slate-50">
        {/* Page Title */}
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            SETTINGS
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage your account preferences and application configuration
          </p>
        </div>

        {/* Settings Sections */}
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

      {/* Footer */}
      <footer className="mb-6 px-6">
        <div className="mb-4 flex h-2 gap-1 rounded-full">
          <div className="h-full flex-1 rounded-full bg-slate-700" />
          <div className="h-full flex-1 rounded-full bg-slate-200" />
          <div className="h-full flex-1 rounded-full bg-slate-200" />
          <div className="h-full flex-1 rounded-full bg-slate-200" />
          <div className="h-full flex-1 rounded-full bg-slate-200" />
        </div>
        <div className="text-center">
          <span className="font-mono text-xs text-slate-400">
            SETTINGS PANEL - V.8.2.21 (Phase 4)
          </span>
        </div>
      </footer>
    </div>
  );
}
