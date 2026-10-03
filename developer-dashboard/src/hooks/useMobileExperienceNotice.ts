import { useCallback, useState } from 'react';
import { useIsMobile } from './useMediaQuery';

const MOBILE_NOTICE_SEEN_KEY = 'bugsafari_mobile_notice_seen';

function hasSeenNotice(): boolean {
  try {
    return localStorage.getItem(MOBILE_NOTICE_SEEN_KEY) === 'true';
  } catch {
    // Private mode / blocked storage — treat as seen so the notice never nags.
    return true;
  }
}

// One-shot, viewport-gated expectation notice. Opens only on a mobile viewport the
// first time, reacts live to resize via useIsMobile, and never gates functionality.
export function useMobileExperienceNotice(): { isOpen: boolean; dismiss: () => void } {
  const isMobile = useIsMobile();
  const [seen, setSeen] = useState(hasSeenNotice);

  const dismiss = useCallback(() => {
    setSeen(true);
    try {
      localStorage.setItem(MOBILE_NOTICE_SEEN_KEY, 'true');
    } catch {
      console.warn('[useMobileExperienceNotice] Failed to persist dismissal');
    }
  }, []);

  return { isOpen: isMobile && !seen, dismiss };
}
