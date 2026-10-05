// Generic first-run guided tour. Auto-launches once per user when `enabled`, and
// always returns startTour so a Help control can replay it on demand. Shared by the
// dashboard, History, and Settings so every tour looks and behaves the same.

import { useCallback, useEffect, useRef } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { useAuth } from '../context/AuthContext';
import { useIsCompact } from '../hooks/useMediaQuery';
import { useSettingsStore } from '../stores/settingsStore';
import { hasCompletedTour, markTourCompleted } from './tourStorage';

interface TourOptions {
  tourId: string;
  // Module-level so its identity is stable across renders — an inline function would
  // re-fire the auto-launch effect every render.
  buildSteps: (isCompact: boolean) => DriveStep[];
  enabled: boolean;
}

export function useTour({ tourId, buildSteps, enabled }: TourOptions): { startTour: () => void } {
  const { user } = useAuth();
  const isCompact = useIsCompact();
  const userId = user?.id ?? null;
  const isAuthenticated = userId !== null;

  // Authenticated users persist the first-run flag to the account (cross-device);
  // guests fall back to device-local storage.
  const accountCompleted = useSettingsStore((s) => s.settings.onboardingCompleted === true);
  const settingsLoading = useSettingsStore((s) => s.isLoading);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const driverRef = useRef<Driver | null>(null);
  const startedRef = useRef(false);

  const hasCompleted = useCallback(
    () => (isAuthenticated ? accountCompleted : hasCompletedTour(tourId, userId)),
    [isAuthenticated, accountCompleted, tourId, userId],
  );

  const markCompleted = useCallback(() => {
    // Stamp the device regardless so this browser stays consistent even offline.
    markTourCompleted(tourId, userId);
    if (isAuthenticated) void updateSettings({ onboardingCompleted: true });
  }, [isAuthenticated, tourId, userId, updateSettings]);

  const startTour = useCallback(() => {
    // Idempotent — a second call (StrictMode re-run, replay double-click) is a no-op.
    if (startedRef.current) return;
    const steps = buildSteps(isCompact);
    // Only the elementless welcome survived — nothing to highlight, so don't start.
    if (steps.length <= 1) {
      markCompleted();
      return;
    }
    startedRef.current = true;
    const instance = driver({
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      animate: true,
      smoothScroll: true,
      allowClose: true,
      disableActiveInteraction: true,
      overlayColor: '#0a0a0a',
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 10,
      showButtons: ['next', 'previous', 'close'],
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Got it',
      steps,
      // Any exit (finish, skip, Esc, overlay) counts as seen — never re-nag.
      onDestroyStarted: () => {
        markCompleted();
        startedRef.current = false;
        instance.destroy();
      },
    });
    driverRef.current = instance;
    instance.drive();
  }, [buildSteps, isCompact, markCompleted]);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    // Wait for the account flag to load so an authenticated user is never re-nagged.
    if (isAuthenticated && settingsLoading) return;
    if (hasCompleted()) return;
    // Let the route transition and first paint settle so anchors measure correctly.
    // Idempotency lives in startedRef, so StrictMode's throwaway pass can reschedule.
    const timer = window.setTimeout(startTour, 400);
    return () => window.clearTimeout(timer);
  }, [enabled, isAuthenticated, settingsLoading, hasCompleted, startTour]);

  useEffect(() => () => driverRef.current?.destroy(), []);

  return { startTour };
}
