import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-shore-bg p-6 text-white">
          <div className="max-w-sm rounded-2xl border border-red-400/30 bg-red-950/40 p-5 text-sm">
            <p className="mb-2 font-semibold text-red-200">界面加载失败</p>
            <p className="text-red-100/80">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
