import { useCallback } from 'react';

import { useIsMobile } from './useMediaQuery';
import { useSettingsStore } from '../stores/settingsStore';

// Phone-only, once-per-user advisory. Account-backed like the first-run tour: authenticated
// users persist dismissal to the account (cross-device), guests fall back to device settings.
// `enabled` scopes it to the dashboard route; advisory only, nothing is gated behind it.
export function useMobileNotice(enabled: boolean): { isOpen: boolean; dismiss: () => void } {
  const isMobile = useIsMobile();
  const dismissed = useSettingsStore((s) => s.settings.mobileNoticeDismissed === true);
  // Hold until settings load so an authenticated user is never re-nagged before the flag arrives.
  const isLoading = useSettingsStore((s) => s.isLoading);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const dismiss = useCallback(() => {
    if (!dismissed) void updateSettings({ mobileNoticeDismissed: true }, { silent: true });
  }, [dismissed, updateSettings]);

  return { isOpen: enabled && isMobile && !isLoading && !dismissed, dismiss };
}
