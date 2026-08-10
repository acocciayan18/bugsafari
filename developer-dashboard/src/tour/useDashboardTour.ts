// Thin wrapper: the dashboard's first-run tour, auto-launched once per user while
// the dashboard sits idle. History and Settings call useTour directly.

import { useTour } from './useTour';
import { buildTourSteps } from './tourSteps';

export function useDashboardTour(enabled: boolean): { startTour: () => void } {
  return useTour({ tourId: 'dashboard', enabled, buildSteps: buildTourSteps });
}
