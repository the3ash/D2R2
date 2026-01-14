import { defineBackground } from 'wxt/utils/define-background'
import { setupEnhancedLogging } from '../utils/helpers'
import { extensionStateManager, pageStateManager } from '../utils/state'
import {
  initializeExtension,
  handleMenuClick,
  reinitializeForTab,
  quickInitialize,
} from '../utils/core'
import { showPageToast, showNotification } from '../utils/notifications'
import { TOAST_STATUS } from '../utils/state/types'
import { getConfig } from '../utils/storage'
import { formatWorkerUrl } from '../utils/helpers'
import { handleError } from '../utils/helpers'

// Setup enhanced logging first
setupEnhancedLogging()

// Track active uploads
const activeUploads = new Map<string, { timestamp: number; tabId: number }>()

// Send heartbeats to active tabs with uploads
const sendHeartbeats = async () => {
  const now = Date.now()
  // Copy activeUploads to avoid iterator invalidation during deletion
  const uploads = [...activeUploads.entries()]

  for (const [toastId, { timestamp, tabId }] of uploads) {
    // If upload is more than 30 seconds old, consider it lost
    if (now - timestamp > 30000) {
      console.log(`Upload ${toastId} timed out after 30 seconds`)
      activeUploads.delete(toastId)
      continue
    }

    try {
      // Send heartbeat to tab
      await chrome.tabs.sendMessage(tabId, {
        action: 'heartbeat',
        toastId,
      })
    } catch (error) {
      console.warn(`Failed to send heartbeat to tab ${tabId}:`, error)
      // If tab doesn't exist anymore, remove the upload
      if (
        (error as any)?.message?.includes('receiving end does not exist') ||
        (error as any)?.message?.includes('tab was closed')
      ) {
        activeUploads.delete(toastId)
      }
    }
  }
}

export default defineBackground(() => {
  console.log('D2R2 extension initializing...')

  // Process any pending menu clicks
  setInterval(() => {
    if (pageStateManager.hasPendingMenuClicks() && extensionStateManager.isReady()) {
      console.log(`Processing ${pageStateManager.getPendingClicksCount()} pending menu clicks...`)
      const pendingClick = pageStateManager.getNextPendingMenuClick()
      if (pendingClick) {
        const elapsedTime = Date.now() - pendingClick.timestamp
        console.log(`Processing click from ${elapsedTime}ms ago`)

        // Get active tab
        const { info, tab } = pendingClick
        const tabId = tab?.id

        // Generate toast ID
        const toastId = `upload_queue_${Date.now()}`

        // Register this as an active upload
        if (tabId) {
          activeUploads.set(toastId, {
            timestamp: Date.now(),
            tabId,
          })
        }

        // Show toast for pending click being processed
        showPageToast(TOAST_STATUS.DROPPING, 'Dropping', 'loading', undefined, toastId)

        handleMenuClick(info, tab)
      }
    }
  }, 1000)

  // Run heartbeat process every 3 seconds
  setInterval(sendHeartbeats, 3000)

  // Add tab update listener
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      console.log(`Tab ${tabId} updated:`, {
        url: tab.url,
        lastUrl: pageStateManager.getActiveUrl(),
        isActiveTab: tabId === pageStateManager.getActiveTab(),
      })

      // Always reinitialize when a tab completes loading
      console.log('Tab changed, reinitializing extension...')
      pageStateManager.setActiveTab(tabId, tab.url)
      await reinitializeForTab(tabId)
    }
  })

  // Add tab activation listener
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    console.log('Tab activated:', activeInfo)
    // Always reinitialize when tab changes
    pageStateManager.setActiveTab(activeInfo.tabId)

    // Get tab URL if needed
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId)
      if (tab.url) {
        pageStateManager.setActiveTab(activeInfo.tabId, tab.url)
      }
    } catch (e) {
      console.error('Error getting tab info:', e)
    }

    await reinitializeForTab(activeInfo.tabId)
  })

  // Add window focus change listener
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    // WINDOW_ID_NONE (-1) means focus left Chrome
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      console.log('Browser window regained focus, windowId:', windowId)

      // Get active tab in focused window
      try {
        const tabs = await chrome.tabs.query({ active: true, windowId })
        if (tabs && tabs.length > 0 && tabs[0].id) {
          console.log('Reinitializing for focused window active tab:', tabs[0].id)
          pageStateManager.setActiveTab(tabs[0].id, tabs[0].url)
          await reinitializeForTab(tabs[0].id)

          // Special handling to ensure menu is working
          extensionStateManager.resetState()
          await quickInitialize()
        }
      } catch (error) {
        const errorMessage = handleError(error, 'window focus handling')
        showPageToast(
          TOAST_STATUS.FAILED,
          errorMessage,
          'error',
          undefined,
          `window_focus_error_${Date.now()}`
        )
      }
    }
  })

  // Create test message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message)

    if (message.action === 'testUpload') {
      const { workerUrl } = message.data || {}
      console.log('Testing Worker connection:', { workerUrl })

      if (!workerUrl) {
        sendResponse({ success: false, error: 'Missing Worker URL' })
        return true
      }

      // Format Worker URL
      const formattedWorkerUrl = formatWorkerUrl(workerUrl)

      // Show test start notification
      try {
        showNotification(TOAST_STATUS.DROPPING, 'Testing Worker connection...', 'loading')
      } catch (e) {
        console.error('Failed to show notification:', e)
      }

      // Test connection with GET request
      fetch(formattedWorkerUrl, {
        method: 'GET',
        headers: {
          Origin: chrome.runtime.getURL(''),
        },
      })
        .then((response) => {
          console.log('Connection test response:', response.status, response.statusText)
          return response.text()
        })
        .then((text) => {
          if (!text || text.trim() === '') {
            showNotification(
              TOAST_STATUS.FAILED,
              'Worker returned an empty response, please check configuration',
              'error'
            )
            sendResponse({
              success: false,
              error: 'Worker returned an empty response',
            })
            return
          }

          try {
            const data = JSON.parse(text)
            if (data && data.success) {
              showNotification(
                TOAST_STATUS.DONE,
                `Worker connection normal: ${data.message || 'Connection successful'}`,
                'success'
              )
              sendResponse({ success: true, data })
            } else {
              const errorMsg = data.error || 'Worker returned an abnormal response'
              showNotification(TOAST_STATUS.FAILED, errorMsg, 'error')
              sendResponse({ success: false, error: errorMsg })
            }
          } catch (e) {
            showNotification(
              TOAST_STATUS.DONE,
              'Worker response is not JSON format, but connection succeeded',
              'success'
            )
            sendResponse({
              success: true,
              data: {
                message: 'Connection successful, but response is not JSON format',
              },
              rawResponse: text,
            })
          }
        })
        .catch((error) => {
          const errorMessage = handleError(error, 'Connection test')
          showNotification(TOAST_STATUS.FAILED, errorMessage, 'error')
          sendResponse({ success: false, error: errorMessage })
        })

      return true
    } else if (message.action === 'checkUploadStatus') {
      // Handle upload status check
      const { toastId } = message
      if (!toastId) {
        sendResponse({ status: 'inactive' })
        return true
      }

      // Check if upload is still active
      if (activeUploads.has(toastId)) {
        sendResponse({ status: 'active' })
      } else {
        sendResponse({ status: 'inactive' })
      }
      return true
    } else if (message.action === 'uploadSuccess' || message.action === 'uploadFailed') {
      // Mark upload as completed
      const { toastId } = message
      if (toastId && activeUploads.has(toastId)) {
        activeUploads.delete(toastId)
      }
      sendResponse({ success: true })
      return true
    }
  })

  // Register context menu click handler
  chrome.contextMenus.onClicked.addListener(handleMenuClick)

  // Initialize the extension when background starts
  // Do not return the promise from here; handle rejections explicitly so
  // the background main remains synchronous and unhandled rejections are logged.
  void initializeExtension().catch((err) => {
    console.error('Background initialization error:', err)
  })
  console.log('D2R2 extension background service started')
})
