// Generic first-run guided tour. Auto-launches once per user when `enabled`, and
// always returns startTour so a Help control can replay it on demand. Shared by the
// dashboard, History, and Settings so every tour looks and behaves the same.

import { useCallback, useEffect, useRef } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { useAuth } from '../context/AuthContext';
import { useIsCompact } from '../hooks/useMediaQuery';
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

  const driverRef = useRef<Driver | null>(null);
  const startedRef = useRef(false);

  const startTour = useCallback(() => {
    // Idempotent — a second call (StrictMode re-run, replay double-click) is a no-op.
    if (startedRef.current) return;
    const steps = buildSteps(isCompact);
    // Only the elementless welcome survived — nothing to highlight, so don't start.
    if (steps.length <= 1) {
      markTourCompleted(tourId, userId);
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
        markTourCompleted(tourId, userId);
        startedRef.current = false;
        instance.destroy();
      },
    });
    driverRef.current = instance;
    instance.drive();
  }, [buildSteps, isCompact, tourId, userId]);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    if (hasCompletedTour(tourId, userId)) return;
    // Let the route transition and first paint settle so anchors measure correctly.
    // Idempotency lives in startedRef, so StrictMode's throwaway pass can reschedule.
    const timer = window.setTimeout(startTour, 400);
    return () => window.clearTimeout(timer);
  }, [enabled, tourId, userId, startTour]);

  useEffect(() => () => driverRef.current?.destroy(), []);

  return { startTour };
}
