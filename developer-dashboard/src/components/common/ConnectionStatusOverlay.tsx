import { useEffect, useRef } from 'react';
import { useToast } from '../../infrastructure/notifications/ToastProvider';

interface ConnectionStatusOverlayProps {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  isRestoring: boolean;
}

// Drives persistent connection-status toasts for the failure modes recovery must
// surface: backend disconnect, reconnection-in-progress, session restore. Renders
// nothing; each toast lives while its state is active and is dismissed on clear.
export default function ConnectionStatusOverlay({
  isConnected,
  isReconnecting,
  reconnectAttempt,
  isRestoring,
}: ConnectionStatusOverlayProps) {
  const { showToast, dismissToast } = useToast();
  const backendId = useRef<string | undefined>(undefined);
  const reconnectId = useRef<string | undefined>(undefined);
  const restoreId = useRef<string | undefined>(undefined);

  // Backend link down and not actively retrying (initial loss).
  const backendDown = !isConnected && !isReconnecting;

  useEffect(() => {
    if (backendDown && !backendId.current) {
      backendId.current = showToast({
        variant: 'error',
        message: 'Connection to BugSafari lost. Attempting to restore…',
        duration: Infinity,
        onDismiss: () => { backendId.current = undefined; },
      });
    } else if (!backendDown && backendId.current) {
      dismissToast(backendId.current);
      backendId.current = undefined;
    }
  }, [backendDown, showToast, dismissToast]);

  // Reconnecting; re-show on each attempt to refresh the count.
  useEffect(() => {
    if (isReconnecting) {
      if (reconnectId.current) dismissToast(reconnectId.current);
      reconnectId.current = showToast({
        variant: 'telemetry',
        message: `Reconnecting to BugSafari${reconnectAttempt > 0 ? ` — attempt ${reconnectAttempt}` : '…'}`,
        duration: Infinity,
        onDismiss: () => { reconnectId.current = undefined; },
      });
    } else if (reconnectId.current) {
      dismissToast(reconnectId.current);
      reconnectId.current = undefined;
    }
  }, [isReconnecting, reconnectAttempt, showToast, dismissToast]);

  // Session restore after reconnect; suppressed while backend is fully down.
  useEffect(() => {
    if (isRestoring && !backendDown) {
      if (!restoreId.current) {
        restoreId.current = showToast({
          variant: 'telemetry',
          message: 'Restoring your active session…',
          duration: Infinity,
          onDismiss: () => { restoreId.current = undefined; },
        });
      }
    } else if (restoreId.current) {
      dismissToast(restoreId.current);
      restoreId.current = undefined;
    }
  }, [isRestoring, backendDown, showToast, dismissToast]);

  // Dismiss any live status toast on unmount.
  useEffect(
    () => () => {
      [backendId, reconnectId, restoreId].forEach((ref) => {
        if (ref.current) dismissToast(ref.current);
      });
    },
    [dismissToast],
  );

  return null;
}
