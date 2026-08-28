import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; label?: string; }
interface State { failed: boolean; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label || 'section'}] render failed:`, error.message);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? <div className="notice">This section is unavailable.</div>;
    return this.props.children;
  }
}
