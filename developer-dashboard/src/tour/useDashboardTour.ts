// Drives the first-run dashboard tour. Auto-launches once per user when idle and
// not yet completed; also returns startTour so a Help control can replay it later.

import { useCallback, useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { useAuth } from '../context/AuthContext';
import { useIsCompact } from '../hooks/useMediaQuery';
import { buildTourSteps } from './tourSteps';
import { hasCompletedTour, markTourCompleted } from './tourStorage';

export function useDashboardTour(enabled: boolean): { startTour: () => void } {
  const { user } = useAuth();
  const isCompact = useIsCompact();
  const userId = user?.id ?? null;

  const driverRef = useRef<Driver | null>(null);
  const startedRef = useRef(false);

  const startTour = useCallback(() => {
    // Idempotent — a second call (StrictMode re-run, replay double-click) is a no-op.
    if (startedRef.current) return;
    const steps = buildTourSteps(isCompact);
    // Only the elementless welcome survived — nothing to highlight, so don't start.
    if (steps.length <= 1) {
      markTourCompleted(userId);
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
      prevBtnText: 'Previous',
      doneBtnText: 'Finish',
      steps,
      // Any exit (Finish, Skip, Esc, overlay) counts as seen — never re-nag.
      onDestroyStarted: () => {
        markTourCompleted(userId);
        startedRef.current = false;
        instance.destroy();
      },
    });
    driverRef.current = instance;
    instance.drive();
  }, [isCompact, userId]);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    if (hasCompletedTour(userId)) return;
    // Let the route transition and first paint settle so anchors measure correctly.
    // No launch latch here: StrictMode clears this timer on its throwaway pass, so the
    // second setup must be free to reschedule. Idempotency lives in startedRef.
    const timer = window.setTimeout(startTour, 400);
    return () => window.clearTimeout(timer);
  }, [enabled, userId, startTour]);

  useEffect(() => () => driverRef.current?.destroy(), []);

  return { startTour };
}
