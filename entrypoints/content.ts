import { defineContentScript } from 'wxt/utils/define-content-script'
import './content/toast.css'
import { isDevelopment } from '../utils/helpers/logger'

declare const chrome: any

// Create logging utility functions that only display logs in development environment
const log = (...args: any[]) => {
  if (isDevelopment()) {
    console.log(...args)
  }
}

const warn = (...args: any[]) => {
  if (isDevelopment()) {
    console.warn(...args)
  }
}

// Add error logging function
const error = (...args: any[]) => {
  // Errors are always logged, but more detailed in development environment
  if (isDevelopment()) {
    console.error(...args)
  } else {
    // Keep error logging concise in production environment
    console.error(args[0])
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    log('D2R2 content script loaded')

    // Track if toast container exists
    let toastContainerExists = false

    // Create toast container
    const setupToastContainer = () => {
      // If it already exists, remove it first (to avoid multiple containers when script is loaded multiple times)
      const existingContainer = document.querySelector('.d2r2-toast-container')
      if (existingContainer) {
        existingContainer.remove()
      }

      const container = document.createElement('div')
      container.className = 'd2r2-toast-container'

      // Ensure container is always mounted to the top level of body
      const appendToBody = () => {
        if (document.body) {
          document.body.appendChild(container)
          toastContainerExists = true
          log('D2R2 toast container appended to body')
        } else {
          warn('Document body not available, will retry appending toast container')
          setTimeout(appendToBody, 100)
        }
      }

      // Try to mount container
      appendToBody()

      return container
    }

    const toastContainer = setupToastContainer()

    // Monitor DOM changes to ensure toast container is not removed
    const setupMutationObserver = () => {
      // Return if browser doesn't support MutationObserver
      if (!window.MutationObserver) {
        warn('MutationObserver not supported, toast container may be unstable')
        return
      }

      // Create observer instance
      const observer = new MutationObserver((mutations) => {
        // If toast container has been removed, re-add it
        if (toastContainerExists && !document.querySelector('.d2r2-toast-container')) {
          warn('Toast container was removed, re-appending to body')
          toastContainerExists = false
          setupToastContainer()
        }
      })

      // Configure observation options
      const config = {
        childList: true,
        subtree: true,
      }

      // Start observing document.body
      if (document.body) {
        observer.observe(document.body, config)
        log('MutationObserver started watching for toast container removal')
      } else {
        // If body doesn't exist, try again later
        setTimeout(() => setupMutationObserver(), 100)
      }
    }

    // Start monitoring
    setupMutationObserver()

    // Store current active upload toast
    let currentUploadToast: HTMLElement | null = null
    let currentUploadTimeoutId: number | null = null
    let currentUploadLastActivity: number | null = null
    let heartbeatIntervalId: number | null = null
    let toastId: string | null = null

    // Helper function to create toast element
    const createToastElement = (type: string, toastId: string) => {
      const toast = document.createElement('div')
      toast.className = `d2r2-toast d2r2-toast-${type}`
      toast.dataset.toastId = toastId
      // Use inline styles to control initial position
      toast.style.transform = 'translateY(-20px)'
      toast.style.opacity = '0'
      toast.style.pointerEvents = 'auto'
      return toast
    }

    // Helper function to update toast content
    const updateToastContent = (toast: HTMLElement, title: string, message: string) => {
      const iconElement = toast.querySelector('.d2r2-toast-icon')
      if (iconElement) {
        iconElement.innerHTML = ''
      }

      const titleElement = toast.querySelector('.d2r2-toast-title')
      if (titleElement) {
        titleElement.textContent = title
      }

      const messageElement = toast.querySelector('.d2r2-toast-message')
      if (messageElement) {
        messageElement.textContent = message
      }
    }

    // Helper function to remove toast
    const removeToast = (toast: HTMLElement) => {
      // First move up and fade out
      toast.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out'
      toast.style.opacity = '0'
      toast.style.transform = 'translateY(-20px)'

      setTimeout(() => {
        toast.remove()
        if (toast === currentUploadToast) {
          currentUploadToast = null
          currentUploadTimeoutId = null
          currentUploadLastActivity = null

          // Clear heartbeat interval if it exists
          if (heartbeatIntervalId !== null) {
            clearInterval(heartbeatIntervalId)
            heartbeatIntervalId = null
          }
        }
      }, 200)
    }

    // Show toast notification
    const showToast = (
      title: string,
      message: string,
      type: 'success' | 'error' | 'info' | 'loading' = 'info',
      imageUrl?: string,
      toastId?: string
    ) => {
      // Map title based on type, but if title is provided and not empty, use it directly
      const displayTitle =
        title && title !== 'Failed' && title !== 'Done' && title !== 'Dropping'
          ? title
          : type === 'loading'
            ? 'Dropping'
            : type === 'success'
              ? 'Done'
              : type === 'error'
                ? 'Failed'
                : title

      // If showing an error or success toast, first remove any existing loading toast
      // with the same ID to prevent duplicate toasts
      if ((type === 'error' || type === 'success') && toastId) {
        const existingToasts = document.querySelectorAll('.d2r2-toast')
        let existingToastFound = false

        existingToasts.forEach((existingToast: Element) => {
          const htmlToast = existingToast as HTMLElement
          if (
            htmlToast.dataset.toastId === toastId &&
            htmlToast.classList.contains('d2r2-toast-loading')
          ) {
            // Instead of removing, update the existing toast
            htmlToast.className = `d2r2-toast d2r2-toast-${type}`
            updateToastContent(htmlToast, displayTitle, message)

            // Update activity timestamp
            currentUploadLastActivity = Date.now()

            // Set timeout for auto-removal
            if (currentUploadTimeoutId !== null) {
              clearTimeout(currentUploadTimeoutId)
            }

            // Set timeout for auto-removal (1 second)
            currentUploadTimeoutId = window.setTimeout(() => removeToast(htmlToast), 1000)

            existingToastFound = true
          }
        })

        // If we updated an existing toast, return it
        if (existingToastFound) {
          return
        }
      }

      // If toastId is provided and matches current upload toast ID, update existing toast
      if (toastId && currentUploadToast && currentUploadToast.dataset.toastId === toastId) {
        if (currentUploadTimeoutId !== null) {
          clearTimeout(currentUploadTimeoutId)
          currentUploadTimeoutId = null
        }

        // Update class name but don't use show class
        currentUploadToast.className = `d2r2-toast d2r2-toast-${type}`
        updateToastContent(currentUploadToast, displayTitle, message)

        // Update activity timestamp for heartbeat check
        currentUploadLastActivity = Date.now()

        // For non-loading toasts, use a timeout to auto-remove
        if (type !== 'loading') {
          currentUploadTimeoutId = window.setTimeout(() => removeToast(currentUploadToast!), 1000)
        }

        // Ensure toast is visible
        currentUploadToast.style.opacity = '1'
        currentUploadToast.style.transform = 'translateY(0)'

        return currentUploadToast
      }

      // Create new toast
      const newToastId = toastId || `toast_${Date.now()}`
      const toast = createToastElement(type, newToastId)

      if (type === 'loading' && toastId) {
        if (currentUploadToast) {
          currentUploadToast.remove()
          if (currentUploadTimeoutId !== null) {
            clearTimeout(currentUploadTimeoutId)
            currentUploadTimeoutId = null
          }
        }
        currentUploadToast = toast
        currentUploadLastActivity = Date.now()

        // Set up heartbeat check for loading toast (every 5 seconds)
        if (heartbeatIntervalId !== null) {
          clearInterval(heartbeatIntervalId)
        }

        heartbeatIntervalId = window.setInterval(() => {
          if (currentUploadLastActivity && Date.now() - currentUploadLastActivity > 10000) {
            // If no activity for 10 seconds, assume the upload is lost and remove toast
            log('No upload activity detected for 10 seconds, removing toast')
            if (currentUploadToast) {
              removeToast(currentUploadToast)
            }
            clearInterval(heartbeatIntervalId!)
            heartbeatIntervalId = null
          }
        }, 5000)
      }

      toast.innerHTML = `
        <div class="d2r2-toast-icon"></div>
        <div class="d2r2-toast-content">
          <div class="d2r2-toast-title">${displayTitle}</div>
          <div class="d2r2-toast-message">${message}</div>
        </div>
      `

      toastContainer.appendChild(toast)

      // Use JavaScript to directly control animation, not relying on CSS classes
      // Ensure it appears from top to bottom
      requestAnimationFrame(() => {
        // Start from top, set styles first
        toast.style.opacity = '0'
        toast.style.transform = 'translateY(-20px)'

        // Force browser repaint
        toast.offsetHeight

        // Set transition
        toast.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out'

        // Move to target position
        toast.style.opacity = '1'
        toast.style.transform = 'translateY(0)'
      })

      // Only set auto-close timeout for non-loading toasts
      if (type !== 'loading') {
        const timeoutId = window.setTimeout(() => removeToast(toast), 1000)

        if (toast === currentUploadToast) {
          currentUploadTimeoutId = timeoutId
        }
      }

      return toast
    }

    // Monitor page visibility to check if user has switched away from page
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Page is now visible again, if we have an active upload toast, remove it
        // This prevents stale toasts when returning to the page
        if (currentUploadToast) {
          removeToast(currentUploadToast)
        }
      }
    })

    // Listen for messages from background
    chrome.runtime.onMessage.addListener(
      (message: any, sender: any, sendResponse: (response?: any) => void) => {
        log('Content script received message:', message)

        if (message.action === 'showToast') {
          const { data } = message
          if (!data) {
            error('Missing toast data')
            sendResponse({ success: false, error: 'Missing toast data' })
            return true
          }
          const { title, message: msg, type, imageUrl, toastId: msgToastId } = data

          // Store toastId for visibility change handling
          if (type === 'loading' && msgToastId) {
            toastId = msgToastId
          } else if (type !== 'loading' && toastId === msgToastId) {
            // Clear toastId when the upload completes
            toastId = null
          }

          try {
            showToast(title, msg, type, imageUrl, msgToastId)
            sendResponse({ success: true })
          } catch (e) {
            error('Error showing toast:', e)
            sendResponse({ success: false, error: String(e) })
          }
          return true
        } else if (message.action === 'updateUploadStatus') {
          // Update the last activity timestamp when we receive upload status updates
          currentUploadLastActivity = Date.now()
          sendResponse({ success: true })
          return true
        } else if (message.action === 'heartbeat') {
          // Handle heartbeat messages to maintain upload toast
          if (message.toastId && message.toastId === toastId && currentUploadToast) {
            log('Received heartbeat for toast:', message.toastId)
            currentUploadLastActivity = Date.now()
          } else {
            log('Received heartbeat but no matching toast')
          }
          sendResponse({ success: true })
          return true
        } else if (message.action === 'ping') {
          log('Received ping from background script')
          sendResponse({ success: true, loaded: true })
          return true
        }

        // Return true for any unhandled messages to indicate async response
        return true
      }
    )
  },
})
