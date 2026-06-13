// ═══════════════════════════════════════════════════════════════════════════════
// Settings - Application Settings Page
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, type FormEvent, useEffect } from 'react';
import { useSettings, applyTheme } from '../hooks/useSettings';
import { useAuth } from '../hooks/useAuth';
import { showSuccessToast, showErrorToast } from '../infrastructure/notifications/toastUtils';

// Icons
const UserIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const LockClosedIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const EyeSlashIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

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
          className={`w-full rounded-lg border bg-slate-50 px-4 py-3 pl-10 pr-10 text-sm text-slate-800 placeholder-slate-300 focus:bg-white focus:outline-none transition-colors ${
            error ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-slate-400'
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

// Toggle Switch component
function ToggleSwitch({
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
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 ${
          checked ? 'bg-slate-800' : 'bg-slate-200'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

// Application Settings Section with toggles
function ApplicationSettingsSection() {
  const { settings, updateSetting } = useSettings();
  
  // Apply theme on mount and when settings change
  useEffect(() => {
    applyTheme(settings);
  }, [settings.darkMode, settings.lightMode]);

  const handleDarkModeChange = (checked: boolean) => {
    if (checked) {
      // Disable light mode, enable dark mode
      updateSetting('darkMode', true);
      updateSetting('lightMode', false);
      showSuccessToast('Dark mode enabled');
    } else {
      updateSetting('darkMode', false);
      showSuccessToast('Dark mode disabled');
    }
    applyTheme({ ...settings, darkMode: checked, lightMode: !checked });
  };

  const handleLightModeChange = (checked: boolean) => {
    if (checked) {
      // Disable dark mode, enable light mode
      updateSetting('lightMode', true);
      updateSetting('darkMode', false);
      showSuccessToast('Light mode enabled');
    } else {
      updateSetting('lightMode', false);
      showSuccessToast('Light mode disabled');
    }
    applyTheme({ ...settings, lightMode: checked, darkMode: !checked });
  };

  const handleNotificationsChange = (checked: boolean) => {
    updateSetting('notifications', checked);
    showSuccessToast(checked ? 'Notifications enabled' : 'Notifications disabled');
  };

  const handleAutoSaveChange = (checked: boolean) => {
    updateSetting('autoSave', checked);
    showSuccessToast(checked ? 'Auto-save enabled' : 'Auto-save disabled');
  };

  return (
    <div className="space-y-2 max-w-md">
      <p className="text-sm text-slate-600 mb-4">
        Configure your application preferences. Theme changes apply immediately.
      </p>
      
      <div className="border-t border-slate-200 pt-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Theme</span>
      </div>
      
      <ToggleSwitch
        checked={settings.darkMode}
        onChange={handleDarkModeChange}
        label="Dark Mode"
        description="Use dark color scheme"
      />
      
      <ToggleSwitch
        checked={settings.lightMode}
        onChange={handleLightModeChange}
        label="Light Mode"
        description="Use light color scheme"
      />
      
      <div className="border-t border-slate-200 pt-4 mt-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Features</span>
      </div>
      
      <ToggleSwitch
        checked={settings.notifications}
        onChange={handleNotificationsChange}
        label="Notifications"
        description="Show desktop notifications"
      />
      
      <ToggleSwitch
        checked={settings.autoSave}
        onChange={handleAutoSaveChange}
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

// Security Settings Section with password change form
function SecuritySettingsSection() {
  const { updatePassword, isLoading } = useAuth();
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');
    
    if (!validateForm()) {
      return;
    }

    const result = await updatePassword(currentPassword, newPassword);
    
    if (result.success) {
      setSuccessMessage('Password updated successfully');
      showSuccessToast('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setErrors({});
    } else {
      const errorMsg = result.error || 'Failed to update password';
      setErrors({ current: errorMsg });
      showErrorToast(errorMsg);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-md">
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
        disabled={isLoading}
        className="w-full rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-md"
      >
        {isLoading ? 'Updating...' : 'Update Password'}
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

  // Render application section with toggles
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

export default function Settings() {
  const { settings } = useSettings();
  const [expandedSection, setExpandedSection] = useState<string | null>('account');

  const toggleSection = (sectionId: string) => {
    setExpandedSection(expandedSection === sectionId ? null : sectionId);
  };

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
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
            title="Help"
          >
            <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
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
            SETTINGS PANEL - V.8.2.19
          </span>
        </div>
      </footer>
    </div>
  );
}
