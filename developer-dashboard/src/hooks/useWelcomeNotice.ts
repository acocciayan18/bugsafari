import { useCallback, useState } from 'react';

const WELCOME_SEEN_KEY = 'bugsafari_welcome_seen';

function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === 'true';
  } catch {
    // Private mode / blocked storage — treat as seen so the notice never nags on every render
    return true;
  }
}

// One-shot first-visit notice. Reads storage lazily so the modal never flashes for returning visitors.
export function useWelcomeNotice(): { isOpen: boolean; dismiss: () => void } {
  const [isOpen, setIsOpen] = useState(() => !hasSeenWelcome());

  const dismiss = useCallback(() => {
    setIsOpen(false);
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, 'true');
    } catch {
      console.warn('[useWelcomeNotice] Failed to persist welcome dismissal');
    }
  }, []);

  return { isOpen, dismiss };
}
