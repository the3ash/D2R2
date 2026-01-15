/**
 * Unified image upload function
 * Single entry point for all upload operations
 */

import { TOAST_STATUS } from '../state/types'
import { showNotification } from '../notifications'
import { formatWorkerUrl } from '../helpers/url'
import { getConfig } from '../storage'
import { maybeCompressImageBlob } from './compress'
import { fetchImageData, createUploadFormData, uploadImageWithRetry } from './upload-core'
import { updateUploadProgress } from './progress'
import {
  handleSuccessfulUpload as handleSuccessfulUploadFromHandlers,
  handleFailedUpload as handleFailedUploadFromHandlers,
} from './handlers'

/**
 * Main upload function - handles the complete upload flow
 *
 * @param info - Context menu click data containing srcUrl
 * @param uploadId - Unique identifier for this upload (created by caller)
 * @param targetFolder - Optional folder to upload to
 * @param tabId - Tab ID for sending progress updates
 */
export async function uploadImage(
  info: chrome.contextMenus.OnClickData,
  uploadId: string,
  targetFolder: string | null = null,
  tabId?: number
): Promise<{ success: boolean; url?: string; error?: string }> {
  console.log(`[Upload][${uploadId}] Starting upload to ${targetFolder || 'root'}`)

  try {
    // Validate source URL
    if (!info.srcUrl) {
      const error = 'No image URL found'
      await handleFailedUploadFromHandlers(error, uploadId)
      return { success: false, error }
    }

    // Get configuration
    const config = await getConfig()
    if (!config.cloudflareId || !config.workerUrl) {
      const error = 'Missing configuration'
      await handleFailedUploadFromHandlers(error, uploadId)
      showNotification(TOAST_STATUS.FAILED, 'Please complete extension configuration', 'error')
      chrome.runtime.openOptionsPage()
      return { success: false, error }
    }

    const formattedWorkerUrl = formatWorkerUrl(config.workerUrl)

    // Stage 1: Fetch image data
    await updateUploadProgress(uploadId, 'fetching', tabId)
    console.log(`[Upload][${uploadId}] Fetching image from: ${info.srcUrl.substring(0, 50)}...`)

    const imageResult = await fetchImageData(info.srcUrl, uploadId)
    if (!imageResult.success || !imageResult.imageBlob) {
      const error = imageResult.error || 'Failed to fetch image'
      await handleFailedUploadFromHandlers(error, uploadId)
      return { success: false, error }
    }

    console.log(
      `[Upload][${uploadId}] Fetched: ${imageResult.imageBlob.size} bytes, type: ${imageResult.imageBlob.type}`
    )

    // Stage 2: Compress if needed
    await updateUploadProgress(uploadId, 'compressing', tabId)
    const uploadBlob = await maybeCompressImageBlob(
      imageResult.imageBlob,
      config.imageQuality ?? 0,
      uploadId
    )

    // Stage 3: Upload to server
    await updateUploadProgress(uploadId, 'uploading', tabId)
    console.log(`[Upload][${uploadId}] Uploading to: ${formattedWorkerUrl}`)

    const { formData } = createUploadFormData(
      uploadBlob,
      info.srcUrl,
      config.cloudflareId,
      targetFolder
    )

    const uploadResult = await uploadImageWithRetry(formData, formattedWorkerUrl, uploadId)

    // Handle result - match original logic from image-handler.ts
    // uploadResult.success means the HTTP request succeeded
    // uploadResult.result.success means the server indicated success
    console.log(`[Upload][${uploadId}] Upload result:`, JSON.stringify(uploadResult))

    if (uploadResult.success && uploadResult.result && uploadResult.result.success) {
      await handleSuccessfulUploadFromHandlers(uploadResult.result as { url: string }, uploadId)
      return { success: true, url: uploadResult.result.url }
    } else {
      const error = uploadResult.error || uploadResult.result?.error || 'Upload failed'
      await handleFailedUploadFromHandlers(error, uploadId)
      return { success: false, error }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Upload][${uploadId}] Error:`, error)
    await handleFailedUploadFromHandlers(errorMessage, uploadId)
    return { success: false, error: errorMessage }
  }
}
