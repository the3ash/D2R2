import { ToastType } from '../state/types'
import { TOAST_STATUS } from '../state/types'

// Helper to show toast notification in web page
export async function showPageToast(
  title: string,
  message: string,
  type: ToastType = 'info',
  imageUrl?: string,
  toastId?: string
) {
  try {
    // Get current active tab
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (!tabs || !tabs[0]?.id) {
      console.error('Unable to get current active tab')
      return
    }

    const activeTab = tabs[0]
    console.log(
      `[Toast][${toastId || 'unknown'}] ${title}: ${message.substring(0, 50)}${
        message.length > 50 ? '...' : ''
      }`
    )

    // Check tab URL to ensure not on chrome:// etc.
    if (
      activeTab.url &&
      (activeTab.url.startsWith('chrome://') ||
        activeTab.url.startsWith('chrome-extension://') ||
        activeTab.url.startsWith('about:'))
    ) {
      console.log(`Cannot show toast on special page: ${activeTab.url}`)
      return
    }

    // Send message to content script
    const tabId = activeTab.id as number
    chrome.tabs.sendMessage(
      tabId,
      {
        action: 'showToast',
        data: { title, message, type, imageUrl, toastId },
      },
      (response) => {
        // Check for errors but don't block execution
        const hasError = chrome.runtime.lastError
        if (hasError) {
          console.log(
            "Toast message may have failed (this is normal if page doesn't allow injection):",
            hasError
          )
          return
        }

        if (response && response.success) {
          console.log('Toast displayed on page')
        } else if (response) {
          console.error('Toast display failed:', response.error || 'Unknown reason')
        } else {
          console.log('No toast response received (content script may not be loaded)')
        }
      }
    )
  } catch (error) {
    console.error('Error showing page toast:', error)
  }
}

// Helper to show system notifications
export function showNotification(title: string, message: string, imageUrl?: string) {
  try {
    // Also try to show toast on page
    const toastType =
      title === TOAST_STATUS.DONE ? 'success' : title === TOAST_STATUS.FAILED ? 'error' : 'loading'
    const notificationId = `d2r2_${Date.now()}`
    showPageToast(title, message, toastType, imageUrl, notificationId)

    console.log(
      `[Notification] ${title}: ${message.substring(0, 50)}${
        message.length > 50 ? '...' : ''
      }${imageUrl ? ` (URL: ${imageUrl})` : ''}`
    )

    // Ensure notification permission
    chrome.permissions.contains({ permissions: ['notifications'] }, (hasPermission) => {
      console.log('Notification permission check:', hasPermission ? 'Granted' : 'Not granted')

      if (!hasPermission) {
        console.error('No notification permission, cannot show notification')
        return
      }

      // Remove sameID click listener
      const handleNotificationClick = (clickedId: string) => {
        console.log(
          `Notification click event triggered, clicked ID: ${clickedId}, expected ID: ${notificationId}`
        )
        if (clickedId === notificationId && imageUrl) {
          console.log(`Notification clicked, opening URL: ${imageUrl}`)
          chrome.tabs.create({ url: imageUrl })
          // Remove notification
          chrome.notifications.clear(clickedId)
          // Remove listener
          chrome.notifications.onClicked.removeListener(handleNotificationClick)
        }
      }

      // Add click listener (if URL exists)
      if (imageUrl) {
        chrome.notifications.onClicked.addListener(handleNotificationClick)
        console.log('Notification click listener added')
      }

      // Get icon's absolute URL
      const iconUrl = chrome.runtime.getURL('icon/48.png')
      console.log('Notification icon URL:', iconUrl)

      chrome.notifications.create(
        notificationId,
        {
          type: 'basic',
          iconUrl: iconUrl,
          title,
          message,
          isClickable: !!imageUrl,
          priority: 2, // High priority
        },
        (createdId) => {
          if (chrome.runtime.lastError) {
            console.error('Notification creation failed:', chrome.runtime.lastError)
            // If creation fails, remove listener
            if (imageUrl) {
              chrome.notifications.onClicked.removeListener(handleNotificationClick)
            }
          } else {
            console.log(`Notification created successfully, ID: ${createdId}`)
          }
        }
      )
    })
  } catch (error) {
    console.error('Error showing notification:', error)
  }
}

// Helper function: Show notification if image is being processed
export function showProcessingNotification(info: chrome.contextMenus.OnClickData) {
  const srcUrl = info.srcUrl ? info.srcUrl.substring(0, 30) + '...' : 'unknown'
  showNotification(TOAST_STATUS.DROPPING, 'Dropping', 'loading')
  console.log('Added to queue, will be processed when extension is fully initialized')
}
