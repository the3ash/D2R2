/**
 * Result handlers and menu/folder processing utilities
 */

import { TOAST_STATUS } from '../state/types'
import { UploadState, uploadTaskManager } from '../state'
import { showNotification, showPageToast } from '../notifications'
import { handleError } from '../helpers/logger'
import { getConfig, AppConfig } from '../storage'
import { parseFolderPath, ROOT_FOLDER_ID, FOLDER_PREFIX, PARENT_MENU_ID } from '../menu'

// Validate configuration for image upload
export async function validateConfig(
  uploadId: string
): Promise<{ valid: boolean; config?: AppConfig }> {
  console.log('Getting configuration...')
  uploadTaskManager.updateTaskState(uploadId, UploadState.LOADING)
  const config = await getConfig()

  if (!config.cloudflareId || !config.workerUrl) {
    console.error('Configuration error: Missing required Cloudflare ID or Worker URL')
    uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, 'Missing configuration')
    showNotification(TOAST_STATUS.FAILED, 'Please complete extension configuration', 'error')
    chrome.runtime.openOptionsPage()
    return { valid: false }
  }

  return { valid: true, config }
}

// Process successful upload
export async function handleSuccessfulUpload(
  result: { url: string },
  uploadId: string,
  notificationId?: string
): Promise<void> {
  try {
    console.log(`Successfully uploaded image: ${result.url}`)
    uploadTaskManager.updateTaskState(uploadId, UploadState.SUCCESS, '')

    await showPageToast(
      TOAST_STATUS.DONE,
      'Upload complete!',
      'success',
      result.url,
      notificationId
    )

    console.log(`Upload task ${uploadId} completed successfully`)
  } catch (error) {
    console.error(`Error in handleSuccessfulUpload for task ${uploadId}:`, error)
  }
}

// Process failed upload
export async function handleFailedUpload(
  errorMessage: string = 'Unknown error',
  uploadId: string,
  notificationId?: string
): Promise<void> {
  try {
    console.error(`Upload failed for task ${uploadId}: ${errorMessage}`)

    let displayMessage = 'Upload failed'

    if (errorMessage.includes('network')) {
      displayMessage = 'Network error. Please check your connection.'
    } else if (errorMessage.includes('timeout')) {
      displayMessage = 'Upload timed out. Please try again.'
    } else if (errorMessage.includes('large') || errorMessage.includes('413')) {
      displayMessage = 'Image is too large. Max size is 20MB.'
    } else if (errorMessage.includes('format') || errorMessage.includes('415')) {
      displayMessage = 'Invalid image format.'
    } else if (errorMessage) {
      displayMessage = `Error: ${errorMessage.substring(0, 100)}${
        errorMessage.length > 100 ? '...' : ''
      }`
    }

    uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, displayMessage)

    await showPageToast(TOAST_STATUS.FAILED, displayMessage, 'error', undefined, notificationId)

    console.log(`Upload task ${uploadId} failed: ${displayMessage}`)
  } catch (error) {
    console.error(`Error in handleFailedUpload for task ${uploadId}:`, error)
  }
}

// Shows loading toast
export async function showLoadingToast(uploadId: string): Promise<void> {
  await showPageToast(TOAST_STATUS.DROPPING, 'Dropping', 'loading', undefined, uploadId)
}

// Check if source URL is valid
export function validateSourceUrl(info: chrome.contextMenus.OnClickData, taskId: string): boolean {
  if (!info.srcUrl) {
    uploadTaskManager.updateTaskState(taskId, UploadState.ERROR, 'Unable to get image URL')
    console.error('Unable to get image URL')
    showNotification(TOAST_STATUS.FAILED, 'Unable to get image URL', 'error')
    return false
  }
  return true
}

// Determine target folder based on menu item ID with passed config
export async function determineTargetFolderWithConfig(
  info: chrome.contextMenus.OnClickData,
  taskId: string,
  config: AppConfig
): Promise<{ isValid: boolean; targetFolder: string | null }> {
  let targetFolder: string | null = null

  if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(FOLDER_PREFIX)) {
    const folderIndex = parseInt(info.menuItemId.substring(FOLDER_PREFIX.length))
    const folders = parseFolderPath(config.folderPath)

    if (folders && folderIndex < folders.length) {
      targetFolder = folders[folderIndex]
      console.log(`Selected folder: ${targetFolder}`)
      uploadTaskManager.setTaskFolder(taskId, targetFolder)
      return { isValid: true, targetFolder }
    } else {
      uploadTaskManager.updateTaskState(taskId, UploadState.ERROR, 'Invalid folder index')
      console.error('Invalid folder index')
      showNotification(TOAST_STATUS.FAILED, 'Invalid target folder', 'error')
      return { isValid: false, targetFolder: null }
    }
  } else if (info.menuItemId === ROOT_FOLDER_ID) {
    console.log('Uploading to root directory')
    uploadTaskManager.setTaskFolder(taskId, null)
    return { isValid: true, targetFolder: null }
  } else if (info.menuItemId === PARENT_MENU_ID) {
    uploadTaskManager.updateTaskState(
      taskId,
      UploadState.ERROR,
      'Parent menu clicked, no action needed'
    )
    console.log('Parent menu clicked, no action taken')
    return { isValid: false, targetFolder: null }
  } else {
    uploadTaskManager.updateTaskState(taskId, UploadState.ERROR, 'Unknown menu ID')
    console.error('Unknown menu item ID:', info.menuItemId)
    showNotification(TOAST_STATUS.FAILED, 'Invalid menu selection', 'error')
    return { isValid: false, targetFolder: null }
  }
}

// Log menu click details
export function logMenuClickDetails(
  info: chrome.contextMenus.OnClickData,
  taskId: string,
  retryCount: number,
  tab?: chrome.tabs.Tab
): void {
  console.log(`Processing menu click (retry=${retryCount}):`, {
    menuItemId: info.menuItemId,
    srcUrl: info.srcUrl ? info.srcUrl.substring(0, 100) + '...' : null,
    tabId: tab?.id,
    timestamp: new Date().toISOString(),
    retryCount: retryCount,
    taskId: taskId,
  })
}

// Handle menu click error with retry support
export function handleMenuClickError(
  error: unknown,
  info: chrome.contextMenus.OnClickData,
  taskId: string,
  retryCount: number,
  processMenuClickFn: (
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab,
    retryCount?: number
  ) => Promise<void>,
  tab?: chrome.tabs.Tab
): void {
  const errorMessage = handleError(error, 'processMenuClick', {
    retryable: retryCount < uploadTaskManager.MAX_RETRY_COUNT,
    retryContext: {
      retryCount,
      maxRetries: uploadTaskManager.MAX_RETRY_COUNT,
      retryInterval: uploadTaskManager.RETRY_INTERVAL,
      retryCallback: () => processMenuClickFn(info, tab, retryCount + 1),
    },
  })

  uploadTaskManager.updateTaskState(taskId, UploadState.ERROR, errorMessage)

  if (retryCount === 0 || retryCount >= uploadTaskManager.MAX_RETRY_COUNT) {
    showNotification(TOAST_STATUS.FAILED, errorMessage, 'error')
    setTimeout(async () => {
      try {
        await showPageToast(TOAST_STATUS.FAILED, errorMessage, 'error', undefined, taskId)
        console.log(`Error toast displayed for task ${taskId}`)
      } catch (toastError) {
        console.error(`Failed to show error toast for task ${taskId}:`, toastError)
      }
    }, 0)
  }
}

// Generate unique ID
export function generateUniqueId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
