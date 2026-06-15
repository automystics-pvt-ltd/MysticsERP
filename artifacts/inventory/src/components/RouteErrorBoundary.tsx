import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[RouteErrorBoundary] Unhandled render error:", error, info.componentStack);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="flex items-center justify-center h-16 w-16 rounded-2xl bg-destructive/10 text-destructive mb-4">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            An unexpected error occurred while rendering this page.
            {import.meta.env.DEV && this.state.error && (
              <span className="block mt-2 font-mono text-xs text-destructive break-all">
                {this.state.error.message}
              </span>
            )}
          </p>
          <Button onClick={this.handleReload} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
