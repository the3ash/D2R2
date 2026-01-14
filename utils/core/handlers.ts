import { extensionStateManager, pageStateManager, uploadTaskManager } from '../state'
import { TOAST_STATUS } from '../state/types'
import { showNotification, showPageToast } from '../notifications'
import { processMenuClick } from '../upload'
import { quickInitialize, performInitialization } from './initialization'
import { handleError } from '../helpers'
import { updateContextMenu } from '../menu'
import { getConfig } from '../storage'

// Initial menu click handler - queues clicks if not ready
export async function handleMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
) {
  try {
    console.log('======= MENU CLICK START =======')
    console.log('Menu data:', {
      menuItemId: info.menuItemId,
      srcUrl: info.srcUrl ? info.srcUrl.substring(0, 50) + '...' : 'none',
      tabId: tab?.id,
    })

    // Create task ID for this operation
    const uploadId = uploadTaskManager.createTask(info, tab)
    console.log(`Created task ID: ${uploadId}`)

    // Check configuration first
    const config = await getConfig()
    if (!config.cloudflareId || !config.workerUrl) {
      console.error('Configuration error: Missing required Cloudflare ID or Worker URL')

      // Show error immediately
      await showPageToast('Complete settings in popup', '', 'error', undefined, uploadId)

      // Open options page
      chrome.runtime.openOptionsPage()

      console.log('Aborted menu click processing due to incomplete configuration')
      return
    }

    // Only show loading toast if config is complete
    await showPageToast(TOAST_STATUS.DROPPING, 'Dropping', 'loading', undefined, uploadId)

    // Update active tab information
    if (tab?.id) {
      pageStateManager.setActiveTab(tab.id, tab.url)
    }

    // Force initialize on menu click to handle window switching
    console.log('Force initializing extension...')
    extensionStateManager.resetState()
    await quickInitialize()
    console.log('Force initialization completed')

    // Process click directly - wait for completion synchronously
    try {
      console.log('Processing menu click for task:', uploadId)
      await processMenuClick(info, tab)
      console.log('Menu click processing completed for task:', uploadId)
    } catch (processingError) {
      console.error('Error processing menu click:', processingError)
      throw processingError // Re-throw the exception for outer catch block to handle
    }
  } catch (error) {
    console.error('======= MENU CLICK ERROR =======', error)
    const errorMessage = handleError(error, 'handleMenuClick')

    // Ensure error status is displayed correctly
    try {
      showNotification(TOAST_STATUS.FAILED, errorMessage, 'error')
      await showPageToast(
        TOAST_STATUS.FAILED,
        errorMessage,
        'error',
        undefined,
        `error_${Date.now()}`
      )
    } catch (notificationError) {
      console.error('Failed to show error notification:', notificationError)
    }

    // Add to pending queue
    pageStateManager.addPendingMenuClick(info, tab)
    console.log('Added to pending queue due to error')
  }
}

// Initialize extension
export async function initializeExtension() {
  try {
    console.log('Starting extension initialization...')

    // Get current active tab
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (tabs && tabs[0]?.id) {
      pageStateManager.setActiveTab(tabs[0].id, tabs[0].url)
      console.log(`Initializing for active tab ${tabs[0].id}`)
    }

    // Core initialization
    await performInitialization('initializeExtension')

    // Listen for configuration changes, update menu
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes['d2r2_config']) {
        console.log('Configuration updated, recreating menu')
        updateContextMenu()
      }
    })

    // Test notification functionality
    console.log('Testing notification functionality...')
    chrome.permissions.contains({ permissions: ['notifications'] }, function (result) {
      if (result) {
        console.log('Notification permission granted, attempting to show welcome notification')

        // Silent initialization, no notification
        console.log('Extension initialized silently')

        // Silent initialization, no test prompt
        console.log('Content script ready, no notification sent')

        // Test page toast notification
        setTimeout(async () => {
          try {
            console.log('Testing page toast notification...')
            // Get current active tab
            const tabs = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            })
            if (tabs && tabs.length > 0 && tabs[0].id) {
              // Check if current tab can be injected
              const tabId = tabs[0].id as number
              console.log(`Attempting to send test toast to tab ${tabId}`)

              // First check if content script is ready
              try {
                chrome.tabs.sendMessage(tabId, { action: 'ping' }, () => {
                  const hasError = chrome.runtime.lastError
                  if (hasError) {
                    console.log(
                      'Content script not responding, may be new page or not loaded: ',
                      hasError
                    )
                    // Don't proceed with test, this is normal for new tabs
                  } else {
                    // Content script is ready, send test notification
                    console.log('Content script ready, no notification sent')
                  }
                })
              } catch (pingError) {
                console.error('Error checking content script: ', pingError)
              }
            } else {
              console.log('No available tabs for toast test')
            }
          } catch (toastTestError) {
            console.error('Error testing page toast:', toastTestError)
          }
        }, 2000)
      } else {
        console.warn('Warning: No notification permission, may not be able to show upload status')
      }
    })

    console.log('D2R2 extension initialization completed ✅')
  } catch (error) {
    const errorMessage = handleError(error, 'extension initialization')
    showPageToast(TOAST_STATUS.FAILED, errorMessage, 'error', undefined, `init_error_${Date.now()}`)
  }
}
