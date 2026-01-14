// Enhanced logging with timestamp
export function setupEnhancedLogging() {
  // Store original console methods
  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn
  const originalInfo = console.info
  const originalDebug = console.debug

  // Use import.meta.env.PROD to detect if it's a production build
  // This is an environment variable provided by Vite during build time
  const isBuildProduction = import.meta.env.PROD

  // Runtime environment detection (not during build)
  let isRuntimeProduction = false

  // Only try to use chrome API when code is actually running (not during build)
  try {
    // Browser runtime, use more precise detection
    if (
      typeof window !== 'undefined' &&
      window.chrome &&
      window.chrome.runtime &&
      window.chrome.runtime.getManifest
    ) {
      // Check if the extension is running in production by checking update_url
      isRuntimeProduction = !!window.chrome.runtime.getManifest().update_url
    }
  } catch {
    // Ignore errors, use build-time determined environment
  }

  // Final environment determination: if either build-time or runtime determines production, it's production
  const isProduction = isBuildProduction || isRuntimeProduction

  if (!isProduction) {
    // Only override console methods in development environment
    // Add more detailed logging with timestamp
    console.log = function (...args) {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
      originalLog.apply(console, [`[${timestamp}]`, ...args])
    }

    console.error = function (...args) {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
      originalError.apply(console, [`[${timestamp}][ERROR]`, ...args])
    }

    console.warn = function (...args) {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
      originalWarn.apply(console, [`[${timestamp}][WARN]`, ...args])
    }

    console.info = function (...args) {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
      originalInfo.apply(console, [`[${timestamp}][INFO]`, ...args])
    }

    console.debug = function (...args) {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
      originalDebug.apply(console, [`[${timestamp}][DEBUG]`, ...args])
    }
  } else {
    // In production, silence all logs except errors
    console.log = function () {}
    console.warn = function () {}
    console.info = function () {}
    console.debug = function () {}

    // Keep error logging but make it minimal
    console.error = function (...args) {
      originalError.apply(console, args)
    }
  }
}

// Create utility functions to check environment
export function isDevelopment(): boolean {
  // First check Vite build environment variable
  if (import.meta.env.PROD) {
    return false
  }

  // If not in build phase, try runtime detection
  if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
    try {
      if (chrome.runtime.getManifest && chrome.runtime.getManifest().update_url) {
        return false
      }
    } catch {
      // If detection fails, default to development environment
    }
  }

  // Default to development environment
  return true
}

export function isProduction(): boolean {
  return !isDevelopment()
}

// Enhanced error handling system
export interface ErrorHandlingOptions {
  showNotification?: boolean
  notificationTitle?: string
  toastId?: string
  notificationImageUrl?: string
  showToast?: boolean
  retryable?: boolean
  retryContext?: {
    retryCount: number
    maxRetries: number
    retryInterval: number
    retryCallback: () => void
  }
}

// Unified error handler with consistent formatting and behavior
export function handleError(
  error: unknown,
  context: string,
  options: ErrorHandlingOptions = {}
): string {
  // Format error message consistently
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined

  // Log error with consistent format
  console.error(`[ERROR][${context}] ${errorMessage}`)
  if (errorStack && isDevelopment()) {
    console.error(`[ERROR][${context}][Stack] ${errorStack}`)
  }

  // Handle retry logic if configured
  if (options.retryable && options.retryContext) {
    const { retryCount, maxRetries, retryInterval, retryCallback } = options.retryContext

    if (retryCount < maxRetries) {
      if (isDevelopment()) {
        console.log(
          `[${context}] Retrying in ${retryInterval}ms (attempt ${retryCount + 1}/${maxRetries})...`
        )
      }
      setTimeout(() => {
        retryCallback()
      }, retryInterval)
    } else {
      console.error(`[ERROR][${context}] Max retry attempts (${maxRetries}) reached, giving up`)
    }
  }

  return errorMessage
}
