import { useEffect, useRef } from 'react';
import { useToast } from '../../infrastructure/notifications/ToastProvider';

interface ConnectionStatusOverlayProps {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  // Socket.IO exhausted its reconnection budget — terminal, needs a manual reload.
  reconnectGaveUp: boolean;
  isRestoring: boolean;
}

// Drives persistent connection-status toasts for the failure modes recovery must
// surface: backend disconnect, reconnection-in-progress, session restore. Renders
// nothing; each toast lives while its state is active and is dismissed on clear.
export default function ConnectionStatusOverlay({
  isConnected,
  isReconnecting,
  reconnectAttempt,
  reconnectGaveUp,
  isRestoring,
}: ConnectionStatusOverlayProps) {
  const { showToast, dismissToast } = useToast();
  const backendId = useRef<string | undefined>(undefined);
  const reconnectId = useRef<string | undefined>(undefined);
  const restoreId = useRef<string | undefined>(undefined);
  const gaveUpId = useRef<string | undefined>(undefined);

  // Backend link down and not actively retrying (initial loss). Suppressed once
  // reconnection has terminally failed — that state owns its own explicit toast.
  const backendDown = !isConnected && !isReconnecting && !reconnectGaveUp;

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

  // Reconnection budget exhausted — a terminal, distinct-from-"reconnecting" state
  // so an operator can tell a dead run from a recovering one. Reload to resume.
  useEffect(() => {
    if (reconnectGaveUp && !gaveUpId.current) {
      gaveUpId.current = showToast({
        variant: 'error',
        message: 'Connection to BugSafari lost. Automatic reconnection failed — reload the page to resume your session.',
        duration: Infinity,
        onDismiss: () => { gaveUpId.current = undefined; },
      });
    } else if (!reconnectGaveUp && gaveUpId.current) {
      dismissToast(gaveUpId.current);
      gaveUpId.current = undefined;
    }
  }, [reconnectGaveUp, showToast, dismissToast]);

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
      [backendId, reconnectId, restoreId, gaveUpId].forEach((ref) => {
        if (ref.current) dismissToast(ref.current);
      });
    },
    [dismissToast],
  );

  return null;
}
