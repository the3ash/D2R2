export * from "./logger";
export * from "./url";
export * from "./debounce";

// Error handling options interface
interface ErrorHandlingOptions {
  showNotification?: boolean;
  notificationTitle?: string;
  toastId?: string;
  notificationImageUrl?: string;
  showToast?: boolean;
  retryable?: boolean;
  retryContext?: {
    retryCount: number;
    maxRetries: number;
    retryInterval: number;
    retryCallback: Function;
  };
}

/**
 * Format Worker URL to ensure proper URL format
 */
export function formatWorkerUrl(url: string): string {
  if (!url) return url;
  const trimmedUrl = url.trim();
  return !trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")
    ? `https://${trimmedUrl}`
    : trimmedUrl;
}

/**
 * Set up enhanced logging functionality
 */
export function setupEnhancedLogging() {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  // Add timestamps to log messages
  console.log = function (...args) {
    const timestamp = new Date().toISOString();
    originalConsoleLog.apply(console, [`[${timestamp}] [LOG]`, ...args]);
  };

  console.warn = function (...args) {
    const timestamp = new Date().toISOString();
    originalConsoleWarn.apply(console, [`[${timestamp}] [WARN]`, ...args]);
  };

  console.error = function (...args) {
    const timestamp = new Date().toISOString();
    originalConsoleError.apply(console, [`[${timestamp}] [ERROR]`, ...args]);
  };
}

/**
 * Unified error handler with consistent formatting and behavior
 */
export function handleError(
  error: unknown,
  context: string,
  options: ErrorHandlingOptions = {}
): string {
  // Format error message consistently
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Log error with consistent format
  console.error(`[ERROR][${context}] ${errorMessage}`);
  if (errorStack) {
    console.error(`[ERROR][${context}][Stack] ${errorStack}`);
  }

  // Handle retry logic if configured
  if (options.retryable && options.retryContext) {
    const { retryCount, maxRetries, retryInterval, retryCallback } =
      options.retryContext;

    if (retryCount < maxRetries) {
      console.log(
        `[${context}] Retrying in ${retryInterval}ms (attempt ${
          retryCount + 1
        }/${maxRetries})...`
      );
      setTimeout(() => {
        retryCallback();
      }, retryInterval);
    } else {
      console.error(
        `[ERROR][${context}] Max retry attempts (${maxRetries}) reached, giving up`
      );
    }
  }

  return errorMessage;
}
