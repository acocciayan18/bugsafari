// Native desktop notifications for run lifecycle events, gated by the Settings
// toggle. Delivery is suppressed while the tab is visible — the telemetry feed and
// toasts already cover the foreground, so a duplicate OS banner is pure noise.

export function isDesktopNotifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// Resolves true only when the browser will actually deliver. A previously denied
// permission cannot be re-prompted, so the caller must surface that as a failure.
export async function requestDesktopNotifyPermission(): Promise<boolean> {
  if (!isDesktopNotifySupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch (error) {
    console.warn('[desktopNotify] Permission request failed:', error);
    return false;
  }
}

// `tag` collapses repeats of the same event into one banner instead of stacking them.
export function notifyDesktop(title: string, body: string, tag: string): void {
  if (!isDesktopNotifySupported() || Notification.permission !== 'granted') return;
  if (!document.hidden) return;

  try {
    new Notification(title, { body, tag });
  } catch (error) {
    console.warn('[desktopNotify] Failed to show notification:', error);
  }
}
