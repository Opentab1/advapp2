/**
 * ErrorBoundary - Graceful error handling for the app
 * 
 * Addresses "Error States" problem:
 * - Catches React errors and shows friendly UI
 * - Provides retry functionality
 * - Logs errors for debugging
 * - Prevents full app crashes
 */

import React, { Component, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { 
  AlertTriangle, 
  RefreshCw, 
  Home,
  WifiOff,
  ServerCrash,
  HelpCircle
} from 'lucide-react';

// ============ TYPES ============

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorType: 'network' | 'server' | 'unknown';
}

interface ErrorFallbackProps {
  error: Error | null;
  errorType: 'network' | 'server' | 'unknown';
  onRetry: () => void;
  onGoHome?: () => void;
}

// ============ ERROR BOUNDARY CLASS ============

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorType: 'unknown' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Determine error type
    let errorType: ErrorBoundaryState['errorType'] = 'unknown';
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('fetch') || message.includes('offline')) {
      errorType = 'network';
    } else if (message.includes('500') || message.includes('server') || message.includes('api')) {
      errorType = 'server';
    }

    return { hasError: true, error, errorType };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error for debugging
    console.error('ErrorBoundary caught error:', error, errorInfo);
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorType: 'unknown' });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          errorType={this.state.errorType}
          onRetry={this.handleRetry}
          onGoHome={this.handleGoHome}
        />
      );
    }

    return this.props.children;
  }
}

// ============ ERROR FALLBACK UI ============

export function ErrorFallback({ error, errorType, onRetry, onGoHome }: ErrorFallbackProps) {
  const getErrorContent = () => {
    switch (errorType) {
      case 'network':
        return {
          icon: WifiOff,
          title: "Connection Lost",
          message: "We can't reach the server. Check your internet connection and try again.",
          color: 'text-amber-500',
          bg: 'bg-amber-50',
        };
      case 'server':
        return {
          icon: ServerCrash,
          title: "Server Issue",
          message: "Our servers are having a moment. We're on it. Try again in a few seconds.",
          color: 'text-red-500',
          bg: 'bg-red-50',
        };
      default:
        return {
          icon: AlertTriangle,
          title: "Something Went Wrong",
          message: "We hit an unexpected bump. Try refreshing the page.",
          color: 'text-warm-500',
          bg: 'bg-warm-50',
        };
    }
  };

  const content = getErrorContent();
  const Icon = content.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-[400px] flex items-center justify-center p-6"
    >
      <div className="max-w-sm w-full text-center">
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className={`w-20 h-20 ${content.bg} rounded-full flex items-center justify-center mx-auto mb-6`}
        >
          <Icon className={`w-10 h-10 ${content.color}`} />
        </motion.div>

        <h2 className="text-xl font-bold text-warm-800 mb-2">{content.title}</h2>
        <p className="text-warm-500 mb-6">{content.message}</p>

        <div className="flex flex-col gap-3">
          <motion.button
            onClick={onRetry}
            className="w-full py-3 px-4 rounded-xl bg-primary text-white font-semibold flex items-center justify-center gap-2 hover:bg-primary-600 transition-colors touch-target"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className="w-5 h-5" />
            Try Again
          </motion.button>

          {onGoHome && (
            <motion.button
              onClick={onGoHome}
              className="w-full py-3 px-4 rounded-xl bg-warm-100 text-warm-700 font-medium flex items-center justify-center gap-2 hover:bg-warm-200 transition-colors touch-target"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Home className="w-5 h-5" />
              Go Home
            </motion.button>
          )}
        </div>

        {error && process.env.NODE_ENV === 'development' && (
          <details className="mt-6 text-left">
            <summary className="text-xs text-warm-400 cursor-pointer">Technical details</summary>
            <pre className="mt-2 p-3 bg-warm-100 rounded-lg text-xs text-warm-600 overflow-auto">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    </motion.div>
  );
}

// ============ INLINE ERROR DISPLAY ============

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function InlineError({ message, onRetry, compact = false }: InlineErrorProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-200">
        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
        <span className="text-xs text-red-700 flex-1">{message}</span>
        {onRetry && (
          <button 
            onClick={onRetry}
            className="p-1 hover:bg-red-100 rounded transition-colors touch-target-sm"
          >
            <RefreshCw className="w-3.5 h-3.5 text-red-500" />
          </button>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-red-50 border border-red-200"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-red-700">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 touch-target-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ============ EMPTY STATE ============

interface EmptyStateProps {
  icon?: typeof HelpCircle;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon = HelpCircle, title, message, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="py-12 px-6 text-center"
    >
      <div className="w-16 h-16 bg-warm-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Icon className="w-8 h-8 text-warm-400" />
      </div>
      <h3 className="text-lg font-semibold text-warm-700 mb-2">{title}</h3>
      <p className="text-warm-500 mb-6 max-w-xs mx-auto">{message}</p>
      {action && (
        <motion.button
          onClick={action.onClick}
          className="px-6 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-600 transition-colors touch-target"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}

export default ErrorBoundary;
