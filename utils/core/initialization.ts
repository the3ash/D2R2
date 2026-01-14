import { extensionStateManager, pageStateManager } from '../state'
import { updateContextMenu } from '../menu'

// Core initialization function to reduce code duplication
export async function performInitialization(source: string, tabId?: number): Promise<boolean> {
  try {
    // Check if initialization should proceed using state manager
    if (!extensionStateManager.startInitialization(source)) {
      return extensionStateManager.isReady()
    }

    console.log(`${source}: Beginning initialization...`)

    // Clear existing menus to avoid conflicts
    try {
      await chrome.contextMenus.removeAll()
      console.log(`${source}: Cleared existing menus`)
    } catch (e) {
      console.log(`${source}: Error clearing menus (non-critical):`, e)
    }

    // Update context menu
    await updateContextMenu()

    // Mark initialization as complete
    extensionStateManager.completeInitialization(true)
    return true
  } catch (error) {
    console.error(`${source}: Initialization failed:`, error)
    extensionStateManager.completeInitialization(false)
    return false
  }
}

// Quick initialization function for faster response
export async function quickInitialize(): Promise<boolean> {
  try {
    // Core initialization
    const initResult = await performInitialization('quickInitialize')
    if (!initResult) {
      return extensionStateManager.isReady()
    }

    // Check content script if we have an active tab
    if (pageStateManager.getActiveTab()) {
      try {
        // Non-blocking ping to content script
        chrome.tabs.sendMessage(
          pageStateManager.getActiveTab() as number,
          { action: 'ping' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.log(
                'Content script not ready in active tab:',
                chrome.runtime.lastError.message
              )
            } else {
              console.log('Content script is ready in active tab')
            }
          }
        )
      } catch (e) {
        console.log('Error checking content script (non-critical):', e)
      }
    }

    // Set flag
    console.log('Quick initialization complete')
    return true
  } catch (error) {
    console.error('Quick initialization failed:', error)
    return false
  }
}

// Add new function to reinitialize extension for a specific tab
export async function reinitializeForTab(tabId: number) {
  try {
    // Core initialization
    const initResult = await performInitialization('reinitializeForTab', tabId)
    if (!initResult) {
      return
    }

    // Reset initialization state
    extensionStateManager.resetState()

    // Verify content script is loaded with timeout
    let contentScriptReady = false
    try {
      await new Promise<void>((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
          if (!chrome.runtime.lastError && response) {
            console.log('Content script verified for tab', tabId)
            contentScriptReady = true
          }
          resolve()
        })

        // Add timeout to ensure promise resolves
        setTimeout(resolve, 300)
      })
    } catch (error) {
      console.log('Content script check error (non-critical):', error)
    }

    // Set initialization flag
    console.log(
      `Extension reinitialized for tab ${tabId}, content script ready: ${contentScriptReady}`
    )

    // Process any pending clicks
    if (pageStateManager.hasPendingMenuClicks()) {
      console.log(
        `Processing ${pageStateManager.getPendingClicksCount()} pending clicks after reinitialization`
      )
    }
  } catch (error) {
    console.error(`Error reinitializing tab ${tabId}:`, error)
    // Still set initialization flag to true to prevent getting stuck
  }
}
