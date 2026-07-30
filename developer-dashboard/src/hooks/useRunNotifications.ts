// Bridges run lifecycle transitions to desktop notifications. Both stores are read
// imperatively inside one subscription so this never re-renders its host — the hook
// only observes, it contributes nothing to the tree.

import { useEffect } from 'react';
import { useRunStore } from '../stores/run/runStore';
import { useSettingsStore } from '../stores/settingsStore';
import { notifyDesktop } from '../utils/desktopNotify';

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
        notifyDesktop(
          'Exploration finished',
          findings > 0 ? `${findings} finding${findings === 1 ? '' : 's'} captured.` : 'No findings captured.',
          'bugsafari-run',
        );
      }
    });
  }, []);
}
