// ═══════════════════════════════════════════════════════════════════════════════
// Settings - Application Settings Page
// ═══════════════════════════════════════════════════════════════════════════════
// Single source of truth for all settings state via useUserSettings.
// Guest mode writes to localStorage; authenticated mode syncs with the backend.
// Dark mode is driven by DarkModeContext — toggling immediately applies the
// 'dark' class to <html> and persists via settings storage.

import { useState, useEffect, useRef, memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  LoaderCircle,
  Monitor,
  Moon,
  Sun,
  User,
  Mail,
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
  CircleQuestionMark,
} from 'lucide-react';
import { toast } from '../../infrastructure/notifications/ToastProvider';

import { useAuth } from '../../hooks/useAuth';
import { useUserSettings } from '../../hooks/useUserSettings';
import { useDarkMode } from '../../context/DarkModeContext';
import { Skeleton } from '../ui/Skeleton';
import { isDesktopNotifySupported, requestDesktopNotifyPermission } from '../../utils/desktopNotify';
import { PASSWORD_MAX_LENGTH } from '../../utils/authLimits';
import { useTour } from '../../tour/useTour';
import { buildSettingsTourSteps } from '../../tour/tourSteps';
import type { ThemeMode } from '../../types';

const ICON_SIZE = 'h-4.5 w-4.5';
const ICON_STROKE = 1.75;

function Spinner() {
  return <LoaderCircle className={`${ICON_SIZE} animate-spin`} strokeWidth={ICON_STROKE} aria-hidden="true" />;
}

// Cards rise in sequence on mount; the grid below drives the stagger.
const CARD_MOTION = { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } };

// ─────────────────────────────────────────────────────────────────────────────
// Card shell — every settings group renders inside one of these
// ─────────────────────────────────────────────────────────────────────────────

function SettingsCard({ icon, title, description, children, dataTour }: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  dataTour?: string;
}) {
  return (
    <motion.section
      data-tour={dataTour}
      variants={CARD_MOTION}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col rounded-xl border border-(--border-hairline) bg-(--surface-panel) shadow-sm"
    >
      <header className="flex items-start gap-3 border-b border-(--border-hairline) px-4 py-4 sm:px-5">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-(--surface-invert) text-(--text-oninvert)">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-(--text-primary)">{title}</h3>
          <p className="text-sm text-(--text-secondary)">{description}</p>
        </div>
      </header>
      <div className="flex-1 px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </motion.section>
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
            className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-app) ${
              selected
                ? 'border-(--border-strong) bg-(--surface-invert) text-(--text-oninvert)'
                : 'border-(--border-hairline) text-(--text-secondary) hover:bg-(--surface-hover)'
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
      <label htmlFor={id} className="block text-sm font-medium text-(--text-secondary) mb-2">
        {label}
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-(--text-tertiary)">
          <Lock className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </div>
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-(--surface-inset) px-4 py-3 pl-10 pr-10 text-sm text-(--text-primary) placeholder-(--text-disabled) focus:bg-(--surface-panel) focus:outline-none transition-colors ${
            error
              ? 'border-(--status-critical-border) focus:border-(--status-critical-fg)'
              : 'border-(--border-hairline) focus:border-(--border-strong)'
          }`}
          placeholder={placeholder || '••••••••'}
          autoComplete={autoComplete}
          maxLength={PASSWORD_MAX_LENGTH}
          required
        />
        <button
          type="button"
          aria-label={showPassword ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={showPassword}
          aria-controls={id}
          className="absolute inset-y-0 right-0 pr-3 flex cursor-pointer items-center text-(--text-tertiary) hover:text-(--text-secondary) focus:outline-none"
          onClick={onTogglePassword}
        >
          {showPassword
            ? <EyeOff className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
            : <Eye className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-(--status-critical-fg)">{error}</p>}
    </div>
  );
}

// Memoized toggle switch — keyboard-accessible (Enter + Space)
export const ToggleSwitch = memo(function ToggleSwitch({
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
    <div className="flex items-center justify-between gap-3 py-3 sm:gap-4">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 text-slate-400 dark:text-zinc-400">
            {icon}
          </div>
        )}
        <div>
          <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {label}
          </span>
          {description && (
            <p className="mt-0.5 text-sm text-slate-600 dark:text-zinc-400">
              {description}
            </p>
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
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-zinc-900 ${
          checked
            ? 'bg-emerald-500 dark:bg-emerald-500' // High-visibility active color (Emerald / Tech Accent)
            : 'bg-slate-300 dark:bg-zinc-700'       // Clear, high-contrast inactive track
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#f4f4f5] shadow-md ring-0 transition duration-200 ease-in-out ${
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
// Theme is applied globally by the settings layer; this only drives instant feedback.
// ─────────────────────────────────────────────────────────────────────────────

// 'unsupported' collapses the no-Notification-API case into the same state machine,
// so the notice below has one source of truth instead of two overlapping checks.
type NotifyPermission = NotificationPermission | 'unsupported';

function readNotifyPermission(): NotifyPermission {
  return isDesktopNotifySupported() ? Notification.permission : 'unsupported';
}

function ApplicationSettingsSection() {
  const { settings, isSettingsLoading, updateSettings } = useUserSettings();
  const { setMode } = useDarkMode();
  const [notifyPermission, setNotifyPermission] = useState<NotifyPermission>(readNotifyPermission);
  // isSettingsLoading also flips true/false around every per-toggle save, not just the
  // initial fetch — gating the skeleton on that alone would unmount/remount this whole
  // section on every click. Only show the skeleton before the first load ever completes.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!isSettingsLoading) {
      hasLoadedRef.current = true;
    }
  }, [isSettingsLoading]);

  // In-flight lock: rapid toggling used to fire concurrent settings PATCHes that
  // resolve out of order (last-write-wins churn). One save at a time.
  const savingRef = useRef(false);

  const handleThemeSelect = async (mode: ThemeMode) => {
    if (savingRef.current) return;
    setMode(mode); // Immediate visual feedback — don't wait for the async save
    savingRef.current = true;
    try {
      await updateSettings({ theme: mode });
    } finally {
      savingRef.current = false;
    }
  };

  // Turning this on is only meaningful once the browser agrees to deliver, so the
  // permission prompt gates the save rather than following it. A denied prompt leaves
  // the stored value untouched — no toggle that claims a capability it does not have.
  const enableNotifications = async (): Promise<void> => {
    const granted = await requestDesktopNotifyPermission();
    setNotifyPermission(readNotifyPermission());

    if (!granted) {
      toast.error(
        isDesktopNotifySupported()
          ? 'Your browser is blocking notifications for this site. Allow them in the browser site settings, then try again.'
          : "This browser doesn't support desktop notifications.",
      );
      return;
    }
    await updateSettings({ notifications: true });
  };

  const handleNotificationsToggle = (value: boolean): void => {
    if (savingRef.current) return;
    savingRef.current = true;
    void (value ? enableNotifications() : updateSettings({ notifications: false }))
      .finally(() => { savingRef.current = false; });
  };

  if (isSettingsLoading && !hasLoadedRef.current) {
    return (
      <div role="status" aria-label="Loading application settings" className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-56 max-w-full" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-[60px] rounded-lg" />
            <Skeleton className="h-[60px] rounded-lg" />
            <Skeleton className="h-[60px] rounded-lg" />
          </div>
        </div>
        <div className="space-y-4 border-t border-(--border-hairline) pt-4">
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-44 max-w-full" />
              </div>
              <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <span className="text-sm font-semibold text-(--text-secondary) uppercase r">Theme</span>
        <p className="mt-0.5 mb-2 text-sm text-(--text-secondary)">Choose how BugSafari looks on this device.</p>
        <ThemeModeControl mode={settings.theme} onChange={handleThemeSelect} />
      </div>

      <div className="border-t border-(--border-hairline) pt-3 divide-y divide-(--border-hairline)">
        <div>
          <ToggleSwitch
            checked={settings.notifications}
            onChange={handleNotificationsToggle}
            label="Notifications"
            description="Desktop alerts when a run finds a bug or finishes, while this tab is in the background"
            icon={<Bell className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
          />
          {/* A stored `true` predates (or outlives) the browser grant — say so instead
              of letting the toggle imply alerts are being delivered. */}
          {settings.notifications && notifyPermission !== 'granted' && (
            <p className="mb-3 rounded-lg border border-(--status-warning-border) bg-(--status-warning-bg) px-3 py-2 text-sm text-(--status-warning-fg)">
              {notifyPermission === 'unsupported'
                ? "This browser doesn't support desktop notifications, so nothing will be delivered."
                : "Your browser hasn't granted notification permission, so nothing will be delivered."}
              {notifyPermission === 'default' && (
                <button
                  type="button"
                  onClick={() => void enableNotifications()}
                  className="ml-2 cursor-pointer font-semibold underline underline-offset-2"
                >
                  Grant permission
                </button>
              )}
            </p>
          )}
        </div>

        <ToggleSwitch
          checked={settings.autoSave}
          onChange={(checked) => void updateSettings({ autoSave: checked })}
          label="Auto Save"
          description="Commit a finished run to history without pressing Save"
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
      // A successful change revokes every session it established, so the store fires
      // 'bugsafari:session-expired' synchronously and App logs out. A deferred
      // close/reset would never run — this component is already unmounting.
      setSuccessMessage('Password changed. Signing you out, please sign in again.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswords({ current: false, new: false, confirm: false });
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
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-(--border-strong) px-4 py-3 text-sm font-semibold text-(--text-secondary) hover:bg-(--surface-hover) transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
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
              <div className="p-3 bg-(--status-stable-bg) border border-(--status-stable-border) rounded-lg">
                <p className="text-sm text-(--status-stable-fg)">{successMessage}</p>
              </div>
            )}

            {/* Backend password errors — e.g. "current password incorrect" */}
            {passwordError && (
              <div className="p-3 bg-(--status-critical-bg) border border-(--status-critical-border) rounded-lg">
                <p className="text-sm text-(--status-critical-fg)">{passwordError}</p>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={isPasswordChanging}
                className="flex-1 rounded-lg bg-(--surface-invert) px-4 py-3 text-sm font-semibold text-(--text-oninvert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active) disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 ease-in-out shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
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
                className="flex items-center justify-center gap-2 rounded-lg border border-(--border-strong) px-4 py-3 text-sm font-semibold text-(--text-secondary) hover:bg-(--surface-hover) disabled:opacity-40 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
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
  const { user, logout, isGuestMode } = useAuth();
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

  // Guests have no server-side profile — only identity-free actions apply.
  if (isGuestMode) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-(--surface-inset)">
            <User className="h-5 w-5 text-(--text-secondary)" strokeWidth={ICON_STROKE} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-(--text-primary)">Guest Session</p>
            <p className="truncate text-sm text-(--text-secondary)">Not signed in</p>
          </div>
        </div>

        <p className="rounded-lg border border-(--border-hairline) bg-(--surface-inset) px-3 py-2.5 text-sm text-(--text-secondary)">
          Exploration runs work normally, but results are not saved to history. Sign in to keep them.
        </p>

        <div className="pt-4 border-t border-(--border-hairline)">
          <button
            onClick={logout}
            className="inline-flex w-fit items-center cursor-pointer justify-center gap-2 rounded-lg border border-(--border-strong) px-4 py-2 text-sm font-semibold text-(--text-secondary) hover:bg-(--surface-hover) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
          >
            <LogOut className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
            Exit Guest Mode
          </button>
        </div>
      </div>
    );
  }

  if (isProfileLoading) {
    return (
      <div role="status" aria-label="Loading account" className="space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-52 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-[92px] rounded-lg" />
        <div className="border-t border-(--border-hairline) pt-4">
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-(--surface-inset)">
          <Mail className="h-5 w-5 text-(--text-secondary)" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-(--text-primary)">
            {displayName || user?.email || 'User'}
          </p>
          {/* Email shows once: primary line when no name, secondary line otherwise. */}
          {displayName && user?.email && (
            <p className="truncate text-sm text-(--text-secondary)">{user.email}</p>
          )}
        </div>
      </div>

      {/* Security lives inside Account now — only authed users reach this return. */}
      <div className="border-t border-(--border-hairline) pt-5">
        <div className="mb-1 flex items-center gap-2 text-(--text-primary)">
          <ShieldCheck className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <h3 className="text-sm font-semibold">Security</h3>
        </div>
        <p className="mb-4 text-sm text-(--text-secondary)">Password and account protection</p>
        <SecuritySettingsSection />
      </div>

      <div className="pt-4 border-t border-(--border-hairline)">
        {showLogoutConfirm ? (
          <div className="space-y-3">
            <p className="text-sm text-(--text-secondary)">Are you sure you want to sign out?</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={handleLogout}
                className="rounded-lg bg-(--status-critical-fg) px-4 py-2 text-sm font-semibold text-(--text-oninvert) hover:opacity-90 active:opacity-80 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
              >
                Yes, Sign Out
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="rounded-lg border border-(--border-strong) px-4 py-2 text-sm font-semibold text-(--text-secondary) hover:bg-(--surface-hover) transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="inline-flex w-fit cursor-pointer items-center justify-center gap-2 rounded-lg border border-(--border-strong) bg-(--surface-raised) px-4 py-2 text-sm font-semibold text-(--text-secondary) hover:bg-(--surface-hover) transition-colors"
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

  // On-demand tour, replayed from the Help (?) control — not auto-launched, so the
  // page never interrupts on arrival.
  const { startTour } = useTour({ tourId: 'settings', enabled: false, buildSteps: buildSettingsTourSteps });

  useEffect(() => {
    if (!isAuthenticated) {
      console.log('[Settings] User not authenticated');
    }
  }, [isAuthenticated]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex h-full w-full min-w-0 flex-col bg-(--surface-panel)"
    >
      {/* Breadcrumb duplicates the compact top bar — desktop only. */}
      <header className="hidden items-center justify-between border-b border-(--border-hairline) px-4 py-4 sm:px-6 lg:flex">
        <div className="flex min-w-0 items-center">
          <span className="text-sm font-bold  text-(--text-primary)">BUGSAFARI</span>
          <span className="mx-3 text-(--text-tertiary)">/</span>
          <span className="text-sm font-semibold text-(--text-secondary)">SETTINGS</span>
        </div>
        {user && (
          <div className="flex shrink-0 items-center">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--surface-inset)">
              <User className="h-5 w-5 text-(--text-secondary)" strokeWidth={ICON_STROKE} aria-hidden="true" />
            </div>
          </div>
        )}
      </header>

      <main className="custom-scrollbar m-3 flex-1 overflow-auto rounded-md border border-(--border-strong) bg-(--surface-app) sm:m-4 lg:m-5">
        <div className="flex items-start justify-between gap-3 border-b border-(--border-hairline) px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-h2 font-bold text-(--text-primary)">SETTINGS</h2>
            <p className="mt-1 text-sm text-(--text-secondary) sm:text-sm">
              Manage your account preferences and application configuration
            </p>
          </div>
          <button
            onClick={startTour}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-(--surface-hover) transition-colors"
            title="Take a tour of this page"
            aria-label="Take a tour of this page"
          >
            <CircleQuestionMark className="h-4 w-4 text-(--text-secondary)" />
          </button>
        </div>

        <motion.div
          initial="hidden"
          animate="shown"
          variants={{ shown: { transition: { staggerChildren: 0.07 } } }}
          className="grid w-full grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-2 lg:p-6"
        >
          <SettingsCard
            dataTour="settings-account"
            icon={<User className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
            title="Account"
            description="Your profile, security, and identity"
          >
            <AccountSection />
          </SettingsCard>

          <SettingsCard
            dataTour="settings-app"
            icon={<Palette className={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />}
            title="Application"
            description="Appearance and behavior"
          >
            <ApplicationSettingsSection />
          </SettingsCard>
        </motion.div>
      </main>
    </motion.div>
  );
}
