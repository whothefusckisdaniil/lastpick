import { Component, type ReactNode } from 'react';

/**
 * A crash inside the match recap (an unexpected OpenDota response, an old
 * cached model…) shows a message with a way out instead of a blank page.
 * Lives in the main chunk: it must work even when the recap chunk fails.
 */
export class MatchErrorBoundary extends Component<
  { children: ReactNode; text: string; reset: string },
  { error: boolean }
> {
  state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  private reset = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('lp.matches')) localStorage.removeItem(k);
    } catch { /* storage blocked */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice mx-auto mt-6 max-w-3xl flex-col !items-start gap-3" role="alert">
        <span className="text-ink">{this.props.text}</span>
        <button type="button" onClick={this.reset} className="btn btn-accent btn-sm">{this.props.reset}</button>
      </div>
    );
  }
}
