import { setupEnhancedLogging as setupLogging, isDevelopment } from "./logger";
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
 * This is a legacy function that now delegates to the newer implementation
 * Kept for backward compatibility
 */
export function setupEnhancedLogging() {
  // Directly call functions imported from logger.ts (using renaming to avoid conflicts)
  setupLogging();
}

/**
 * Unified error handler with consistent formatting and behavior
 * @deprecated Use the handleError from logger.ts instead
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
  if (errorStack && isDevelopment()) {
    console.error(`[ERROR][${context}][Stack] ${errorStack}`);
  }

  // Handle retry logic if configured
  if (options.retryable && options.retryContext) {
    const { retryCount, maxRetries, retryInterval, retryCallback } =
      options.retryContext;

    if (retryCount < maxRetries) {
      if (isDevelopment()) {
        console.log(
          `[${context}] Retrying in ${retryInterval}ms (attempt ${
            retryCount + 1
          }/${maxRetries})...`
        );
      }
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
