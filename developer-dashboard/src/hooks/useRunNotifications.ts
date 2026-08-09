// Bridges run lifecycle transitions to desktop notifications. Both stores are read
// imperatively inside one subscription so this never re-renders its host — the hook
// only observes, it contributes nothing to the tree.

import { useEffect } from 'react';
import { useRunStore } from '../stores/run/runStore';
import { useSettingsStore } from '../stores/settingsStore';
import { notifyDesktop } from '../utils/desktopNotify';
import { playSuccessSound, playErrorSound } from '../utils/notifySound';
import { isCleanTermination } from '../types';

export function useRunNotifications(): void {
  useEffect(() => {
    // Only the FIRST finding of a run is announced; a crashing app can emit dozens.
    let announcedFirstFinding = false;

    return useRunStore.subscribe((state, prev) => {
      if (state.isTestRunning && !prev.isTestRunning) announcedFirstFinding = false;
      if (!useSettingsStore.getState().settings.notifications) return;

      const findings = state.incidents.length + state.reports.length;
      const prevFindings = prev.incidents.length + prev.reports.length;

      if (!announcedFirstFinding && findings > prevFindings) {
        announcedFirstFinding = true;
        notifyDesktop(
          'BugSafari caught a bug',
          `First finding captured on ${state.currentUrl || 'the target app'}.`,
          'bugsafari-finding',
        );
      }

      if (state.hasRunCompleted && !prev.hasRunCompleted) {
        // Away-only, like the banner: a visible tab already shows the terminal state.
        // One sound per terminal transition — dedup is the !prev guard, no repeats.
        if (document.hidden) {
          const outcome = state.terminationOutcome;
          const success = outcome ? isCleanTermination(outcome) : state.status === 'FINISHED';
          (success ? playSuccessSound : playErrorSound)();
        }

        notifyDesktop(
          'Exploration finished',
          findings > 0 ? `${findings} finding${findings === 1 ? '' : 's'} captured.` : 'No findings captured.',
          'bugsafari-run',
        );
      }
    });
  }, []);
}
