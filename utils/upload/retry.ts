/**
 * Error classification and retry strategy utilities
 */

// Error types classification for retry decision
export enum ErrorCategory {
  TEMPORARY = "temporary",
  PERMANENT = "permanent",
  RATE_LIMIT = "rate_limit",
  TIMEOUT = "timeout",
  UNKNOWN = "unknown",
}

// Network condition status
export enum NetworkCondition {
  GOOD = "good",
  DEGRADED = "degraded",
  POOR = "poor",
  OFFLINE = "offline",
}

// Classify error types for retry decisions
export function classifyError(
  error: Error | string,
  status?: number,
): ErrorCategory {
  const errorMessage = typeof error === "string" ? error : error.message;

  if (
    errorMessage.includes("network") ||
    errorMessage.includes("connection") ||
    errorMessage.includes("socket") ||
    errorMessage.includes("ECONNRESET") ||
    errorMessage.includes("ETIMEDOUT") ||
    errorMessage.includes("ENOTFOUND")
  ) {
    return ErrorCategory.TEMPORARY;
  }

  if (
    errorMessage.includes("timeout") ||
    errorMessage.includes("abort") ||
    errorMessage.includes("timed out")
  ) {
    return ErrorCategory.TIMEOUT;
  }

  if (
    errorMessage.includes("rate limit") ||
    errorMessage.includes("too many requests") ||
    status === 429
  ) {
    return ErrorCategory.RATE_LIMIT;
  }

  if (
    errorMessage.includes("not found") ||
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("forbidden") ||
    errorMessage.includes("bad request") ||
    errorMessage.includes("invalid") ||
    (status &&
      (status === 400 || status === 401 || status === 403 || status === 404))
  ) {
    return ErrorCategory.PERMANENT;
  }

  return ErrorCategory.UNKNOWN;
}

// Estimate network condition based on recent request performance
export function estimateNetworkCondition(
  recentErrors: ErrorCategory[] = [],
): NetworkCondition {
  const timeoutCount = recentErrors.filter(
    (e) => e === ErrorCategory.TIMEOUT,
  ).length;
  const temporaryErrorCount = recentErrors.filter(
    (e) => e === ErrorCategory.TEMPORARY,
  ).length;

  if (timeoutCount >= 2 || temporaryErrorCount >= 3) {
    return NetworkCondition.POOR;
  } else if (timeoutCount === 1 || temporaryErrorCount >= 1) {
    return NetworkCondition.DEGRADED;
  } else if (navigator.onLine === false) {
    return NetworkCondition.OFFLINE;
  } else {
    return NetworkCondition.GOOD;
  }
}

// Calculate optimal retry delay
export function calculateRetryDelay(
  retryCount: number,
  errorCategory: ErrorCategory,
  networkCondition: NetworkCondition,
): number {
  let baseDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);
  const jitter = Math.random() * 0.3 * baseDelay;
  baseDelay = baseDelay + jitter;

  switch (errorCategory) {
    case ErrorCategory.RATE_LIMIT:
      return baseDelay * 2;
    case ErrorCategory.TIMEOUT:
      return baseDelay * 1.5;
    case ErrorCategory.TEMPORARY:
      return baseDelay;
    case ErrorCategory.PERMANENT:
      return 0;
    default:
      return baseDelay;
  }
}

// Determine if a request should be retried
export function shouldRetry(
  error: Error | string,
  retryCount: number,
  maxRetries: number,
  responseStatus?: number,
): { retry: boolean; delay: number; reason: string } {
  if (retryCount >= maxRetries) {
    return {
      retry: false,
      delay: 0,
      reason: `Maximum retry count (${maxRetries}) reached`,
    };
  }

  const errorCategory = classifyError(error, responseStatus);

  if (errorCategory === ErrorCategory.PERMANENT) {
    return {
      retry: false,
      delay: 0,
      reason: `Error is permanent: ${
        typeof error === "string" ? error : error.message
      }`,
    };
  }

  const networkCondition = estimateNetworkCondition([errorCategory]);

  if (networkCondition === NetworkCondition.OFFLINE && retryCount > 0) {
    return { retry: false, delay: 0, reason: "Device appears to be offline" };
  }

  const delay = calculateRetryDelay(
    retryCount,
    errorCategory,
    networkCondition,
  );

  return {
    retry: true,
    delay,
    reason: `Retrying after ${errorCategory} error with ${networkCondition} network`,
  };
}

// Generate enhanced error message based on diagnostics
export function getEnhancedErrorMessage(
  errorMessage: string | undefined,
  retryCount: number,
  maxRetries: number,
  networkCondition: NetworkCondition,
  status?: number,
): string {
  if (!errorMessage) return "Unknown upload error";

  let enhancedMessage = `Failed after ${retryCount} retries.`;

  if (networkCondition !== NetworkCondition.GOOD) {
    enhancedMessage += ` Network appears to be ${networkCondition}.`;
  }

  if (status) {
    if (status === 413) {
      enhancedMessage += " The image may be too large for the server.";
    } else if (status === 415) {
      enhancedMessage += " Invalid image format.";
    } else if (status === 429) {
      enhancedMessage += " Server rate limit reached. Please try again later.";
    } else if (status >= 500) {
      enhancedMessage += " Server is experiencing problems.";
    }
  }

  enhancedMessage += ` Error: ${errorMessage}`;

  return enhancedMessage;
}
