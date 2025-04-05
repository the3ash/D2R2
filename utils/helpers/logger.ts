// Enhanced logging with timestamp
export function setupEnhancedLogging() {
  // Add more detailed logging
  console.log = (function (originalLog) {
    return function (...args) {
      const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);
      originalLog.apply(console, [`[${timestamp}]`, ...args]);
    };
  })(console.log);

  console.error = (function (originalError) {
    return function (...args) {
      const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);
      originalError.apply(console, [`[${timestamp}][ERROR]`, ...args]);
    };
  })(console.error);
}

// Enhanced error handling system
export interface ErrorHandlingOptions {
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

// Unified error handler with consistent formatting and behavior
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
