import { extensionStateManager, pageStateManager, uploadTaskManager } from '../state'
import { TOAST_STATUS } from '../state/types'
import { showNotification, showPageToast } from '../notifications'
import { uploadImage } from '../upload'
import { quickInitialize, performInitialization } from './initialization'
import { handleError } from '../helpers'
import { updateContextMenu, parseFolderPath, ROOT_FOLDER_ID, FOLDER_PREFIX, PARENT_MENU_ID } from '../menu'
import { getConfig } from '../storage'

/**
 * Determine target folder based on menu item ID
 */
function determineTargetFolder(
  menuItemId: string | number,
  folders: string[]
): { valid: boolean; folder: string | null; error?: string } {
  const menuId = String(menuItemId)

  if (menuId === ROOT_FOLDER_ID) {
    return { valid: true, folder: null }
  }

  if (menuId === PARENT_MENU_ID) {
    // Parent menu clicked, no action needed
    return { valid: false, folder: null, error: 'Parent menu clicked' }
  }

  if (menuId.startsWith(FOLDER_PREFIX)) {
    const folderIndex = parseInt(menuId.substring(FOLDER_PREFIX.length))
    if (folders && folderIndex < folders.length) {
      return { valid: true, folder: folders[folderIndex] }
    }
    return { valid: false, folder: null, error: 'Invalid folder index' }
  }

  return { valid: false, folder: null, error: 'Unknown menu ID' }
}

/**
 * Main menu click handler - unified entry point for all uploads
 */
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

    // Create unique upload ID - this ID will be used throughout the entire upload process
    const uploadId = uploadTaskManager.createTask(info, tab)
    console.log(`Created upload ID: ${uploadId}`)

    // Get configuration
    const config = await getConfig()
    if (!config.cloudflareId || !config.workerUrl) {
      console.error('Configuration error: Missing required Cloudflare ID or Worker URL')
      await showPageToast('Complete settings in popup', '', 'error', undefined, uploadId)
      chrome.runtime.openOptionsPage()
      console.log('Aborted: incomplete configuration')
      return
    }

    // Determine target folder based on menu item
    const folders = parseFolderPath(config.folderPath)
    const folderResult = determineTargetFolder(info.menuItemId, folders)

    if (!folderResult.valid) {
      if (folderResult.error === 'Parent menu clicked') {
        console.log('Parent menu clicked, ignoring')
        return
      }
      console.error(`Folder determination failed: ${folderResult.error}`)
      await showPageToast(TOAST_STATUS.FAILED, folderResult.error || 'Invalid selection', 'error', undefined, uploadId)
      return
    }

    // Update task with folder info
    uploadTaskManager.setTaskFolder(uploadId, folderResult.folder)

    // Show loading toast with the unified uploadId
    await showPageToast(
      TOAST_STATUS.DROPPING,
      `Uploading to ${folderResult.folder || 'root'}...`,
      'loading',
      undefined,
      uploadId
    )

    // Update active tab information
    if (tab?.id) {
      pageStateManager.setActiveTab(tab.id, tab.url)
    }

    // Quick initialize if needed
    if (!extensionStateManager.isReady()) {
      console.log('Extension not ready, quick initializing...')
      extensionStateManager.resetState()
      await quickInitialize()
      console.log('Quick initialization completed')
    }

    // Execute upload with the same uploadId
    console.log(`Starting upload for task: ${uploadId}`)
    const result = await uploadImage(info, uploadId, folderResult.folder, tab?.id)

    if (result.success) {
      console.log(`Upload completed successfully: ${result.url}`)
    } else {
      console.log(`Upload failed: ${result.error}`)
    }

    console.log('======= MENU CLICK END =======')
  } catch (error) {
    console.error('======= MENU CLICK ERROR =======', error)
    const errorMessage = handleError(error, 'handleMenuClick')

    // Show error notification
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

    // Add to pending queue for retry
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
