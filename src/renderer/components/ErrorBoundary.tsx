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
        <div className="relative h-screen overflow-hidden">
          <div className="keeper-sky absolute inset-0" />
          <div className="relative z-10 flex h-full items-center justify-center p-6">
          <div className="max-w-sm rounded-2xl border border-red-400/30 bg-keeper-navy/80 p-5 text-sm backdrop-blur-md">
            <p className="mb-2 font-semibold text-red-300">界面加载失败</p>
            <p className="text-keeper-ice/70">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              className="no-drag mt-4 rounded-xl border border-keeper-cyan/30 bg-keeper-cyan/10 px-4 py-2 text-xs text-keeper-cyan transition hover:bg-keeper-cyan/20"
            >
              重新加载
            </button>
          </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
