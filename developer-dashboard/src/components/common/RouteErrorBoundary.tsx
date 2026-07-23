import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { logger } from '../../utils/logger';

interface RouteErrorBoundaryProps {
  // Distinct value per route — a change resets the boundary so navigating away recovers.
  resetKey?: string;
  label?: string;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

// Route-scoped error boundary. A render throw in a live panel used to unmount the
// whole dashboard and lose in-memory run state. Here the socket + zustand stores
// are module singletons that outlive this subtree, so "Reload panel" remounts the
// children and they rehydrate from the still-live active-session state.
export default class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prev: RouteErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error(`[${this.props.label ?? 'RouteErrorBoundary'}] Render error:`, error, info.componentStack);
  }

  private readonly retry = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-(--surface-app) p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-(--status-critical-border) text-(--status-critical-fg)">
          <TriangleAlert className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="max-w-md space-y-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-(--text-primary)">This panel hit an error</h2>
          <p className="text-[13px] text-(--text-secondary)">
            The rest of the app and your live session are still running. Reload the panel to recover the view.
          </p>
          <p className="font-mono text-[11px] text-(--text-tertiary) break-words">{this.state.error.message}</p>
        </div>
        <button
          onClick={this.retry}
          className="flex items-center gap-2 rounded-lg bg-(--surface-invert) px-4 py-2 text-[13px] font-bold uppercase tracking-wider text-(--text-oninvert) transition-colors hover:bg-(--surface-invert-hover)"
        >
          <RotateCw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Reload panel
        </button>
      </div>
    );
  }
}
