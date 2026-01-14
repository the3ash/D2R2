/**
 * Main image upload handlers - entry points for upload operations
 */

import { TOAST_STATUS } from '../state/types'
import { UploadState, uploadTaskManager, extensionStateManager } from '../state'
import { maybeCompressImageBlob } from './compress'
import { showNotification, showPageToast, showProcessingNotification } from '../notifications'
import { formatWorkerUrl } from '../helpers/url'
import { getConfig } from '../storage'

// Import from split modules
import { fetchImageData, createUploadFormData, uploadImageWithRetry } from './upload-core'
import {
  validateConfig,
  handleSuccessfulUpload,
  handleFailedUpload,
  showLoadingToast,
  validateSourceUrl,
  determineTargetFolderWithConfig,
  logMenuClickDetails,
  handleMenuClickError,
  generateUniqueId,
} from './handlers'

// Handle context menu click
export async function handleImageClick(
  info: chrome.contextMenus.OnClickData,
  targetFolder?: string | null
) {
  console.log('Starting image upload...')

  if (!info.srcUrl) {
    console.error('Error: Unable to get image URL')
    showNotification(TOAST_STATUS.FAILED, 'Unable to get image URL', 'error')
    return
  }

  const uploadId = uploadTaskManager.createTask(info, targetFolder)

  try {
    console.log(
      JSON.stringify({
        operation: 'imageUpload',
        imageUrl: info.srcUrl.substring(0, 100) + '...',
        targetFolder: targetFolder || '(Upload to root directory)',
        taskId: uploadId,
      })
    )

    const configResult = await validateConfig(uploadId)
    if (!configResult.valid) return
    const config = configResult.config

    const folderPath = targetFolder || null
    uploadTaskManager.setTaskFolder(uploadId, folderPath)

    await showLoadingToast(uploadId)

    const [imageDataResult] = await Promise.all([fetchImageData(info.srcUrl, uploadId)])

    if (!imageDataResult.success) {
      await showPageToast(
        TOAST_STATUS.FAILED,
        `Failed to get image: ${imageDataResult.error}`,
        'error',
        undefined,
        uploadId
      )
      return
    }

    uploadTaskManager.updateTaskState(uploadId, UploadState.PROCESSING)
    await showLoadingToast(uploadId)

    const formattedWorkerUrl = formatWorkerUrl(config.workerUrl)

    const uploadBlob = await maybeCompressImageBlob(
      imageDataResult.imageBlob!,
      config.imageQuality ?? 0,
      uploadId
    )

    await showLoadingToast(uploadId)

    const { formData } = createUploadFormData(
      uploadBlob,
      info.srcUrl,
      config.cloudflareId,
      folderPath
    )

    const uploadResult = await uploadImageWithRetry(formData, formattedWorkerUrl, uploadId)

    if (uploadResult.success && uploadResult.result.success) {
      await handleSuccessfulUpload(uploadResult.result, uploadId)
    } else {
      await handleFailedUpload(uploadResult.error || uploadResult.result?.error, uploadId)
    }
  } catch (error) {
    console.error('Error handling upload:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, errorMessage)

    await showPageToast(
      TOAST_STATUS.FAILED,
      `Error occurred during upload: ${errorMessage}`,
      'error',
      undefined,
      uploadId
    )
  }
}

// Handle image upload
export async function handleImageUpload(
  info: chrome.contextMenus.OnClickData,
  targetFolder: string | null = null
): Promise<boolean> {
  const uploadId = generateUniqueId()
  console.log(`Starting image upload task: ${uploadId}`)

  try {
    uploadTaskManager.createTask(info, targetFolder)
    const notificationId = showProcessingNotification(info, 'Processing image')
    console.log(`Created processing notification: ${notificationId}`)

    const initPromise = new Promise<boolean>(async (resolve) => {
      if (!extensionStateManager.isReady()) {
        console.log('Extension not fully initialized, will queue upload and wait')

        showProcessingNotification(
          info,
          'Added to queue, will be processed when extension is fully initialized'
        )

        let waitCount = 0
        const maxWaitCount = 10

        while (!extensionStateManager.isReady() && waitCount < maxWaitCount) {
          waitCount++
          console.log(`Waiting for extension initialization... (${waitCount})`)
          await new Promise((r) => setTimeout(r, 500))

          if (waitCount % 3 === 0) {
            showProcessingNotification(info, `Waiting for extension (attempt ${waitCount})...`)
          }
        }

        if (!extensionStateManager.isReady()) {
          uploadTaskManager.updateTaskState(
            uploadId,
            UploadState.ERROR,
            'Extension initialization failed'
          )
          await showPageToast(
            TOAST_STATUS.FAILED,
            'Extension initialization failed, please reload the extension',
            'error',
            undefined,
            notificationId
          )
          resolve(false)
          return
        } else {
          uploadTaskManager.updateTaskState(uploadId, UploadState.LOADING, '')
          showProcessingNotification(info, 'Extension initialized, proceeding with upload...')
        }
      }
      resolve(true)
    })

    const configPromise = getConfig()
    const [initSuccess, config] = await Promise.all([initPromise, configPromise])

    if (!initSuccess) return false

    console.log(
      'Processing image upload...',
      targetFolder ? `to folder: ${targetFolder}` : 'to root directory'
    )

    if (!config.cloudflareId || !config.workerUrl) {
      console.error('Configuration error: Missing required Cloudflare ID or Worker URL')
      uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, 'Configuration missing')
      showNotification(TOAST_STATUS.FAILED, 'Please complete extension configuration', 'error')
      chrome.runtime.openOptionsPage()
      return false
    }

    const formattedWorkerUrl = formatWorkerUrl(config.workerUrl)

    console.log(`Getting image data for task ${uploadId}...`)
    uploadTaskManager.updateTaskState(uploadId, UploadState.FETCHING, '')
    showProcessingNotification(info, 'Fetching image data...')

    if (!info.srcUrl) {
      console.error('No source URL available for image')
      uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, 'No image URL')
      await showPageToast(
        TOAST_STATUS.FAILED,
        'No image URL found',
        'error',
        undefined,
        notificationId
      )
      return false
    }

    try {
      const imageUrl = info.srcUrl
      console.log(`Processing image from: ${imageUrl.substring(0, 50)}...`)

      const imageResult = await fetchImageData(imageUrl, uploadId)
      if (!imageResult.success || !imageResult.imageBlob) {
        const errorMessage = imageResult.error || 'Failed to fetch image'
        console.error(`Failed to get image data: ${errorMessage}`)
        uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, errorMessage)
        await showPageToast(
          TOAST_STATUS.FAILED,
          `Failed to get image: ${errorMessage}`,
          'error',
          undefined,
          notificationId
        )
        return false
      }

      console.log(
        `Successfully fetched image: ${imageResult.imageBlob.size} bytes, type: ${imageResult.imageBlob.type}`
      )

      const uploadBlob = await maybeCompressImageBlob(
        imageResult.imageBlob,
        config.imageQuality ?? 0,
        uploadId
      )

      showProcessingNotification(info, 'Uploading to storage...')
      uploadTaskManager.updateTaskState(uploadId, UploadState.UPLOADING, '')

      const formData = new FormData()
      const fileExt = uploadBlob.type.split('/')[1] || imageUrl.split('.').pop() || 'jpg'
      const fileName = `image_${Date.now()}.${fileExt}`

      formData.append(
        'file',
        new File([uploadBlob], fileName, {
          type: uploadBlob.type,
        })
      )
      formData.append('cloudflareId', config.cloudflareId)

      if (targetFolder) {
        formData.append('folderName', targetFolder)
      }

      console.log(`Uploading to: ${formattedWorkerUrl}`)

      const uploadResult = await uploadImageWithRetry(formData, formattedWorkerUrl, uploadId)

      if (uploadResult.success && uploadResult.result.success) {
        await handleSuccessfulUpload(uploadResult.result, uploadId, notificationId)
        return true
      } else {
        await handleFailedUpload(
          uploadResult.error || uploadResult.result?.error,
          uploadId,
          notificationId
        )
        return false
      }
    } catch (uploadError) {
      console.error(`Upload failed for task ${uploadId}:`, uploadError)
      throw uploadError
    }
  } catch (error) {
    console.error(`Error in handleImageUpload for task ${uploadId}:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, errorMessage)

    showNotification(TOAST_STATUS.FAILED, errorMessage, 'error')

    return false
  }
}

// Handle menu click event with retries
export async function processMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
  retryCount = 0
) {
  console.log(`processMenuClick START (retry=${retryCount})`)

  const taskId = uploadTaskManager.createTask(info, tab)
  console.log(`Created task ${taskId} for menu click processing`)

  try {
    logMenuClickDetails(info, taskId, retryCount, tab)

    console.log(`Validating source URL for task ${taskId}`)
    if (!validateSourceUrl(info, taskId)) {
      console.log(`Source URL validation failed for task ${taskId}`)

      await showPageToast(TOAST_STATUS.FAILED, 'Invalid image URL', 'error', undefined, taskId)
      return
    }

    console.log('Getting configuration...')
    const config = await getConfig()

    if (!config.cloudflareId || !config.workerUrl) {
      console.error('Configuration error: Missing required Cloudflare ID or Worker URL')
      uploadTaskManager.updateTaskState(taskId, UploadState.ERROR, 'Missing configuration')
      showNotification(TOAST_STATUS.FAILED, 'Please complete extension configuration', 'error')

      await showPageToast(
        TOAST_STATUS.FAILED,
        'Please complete extension configuration',
        'error',
        undefined,
        taskId
      )

      chrome.runtime.openOptionsPage()
      return
    }

    console.log(`Determining target folder for task ${taskId}`)
    const folderResult = await determineTargetFolderWithConfig(info, taskId, config)
    if (!folderResult.isValid) {
      console.log(`Target folder determination failed for task ${taskId}`)

      await showPageToast(TOAST_STATUS.FAILED, 'Invalid target folder', 'error', undefined, taskId)
      return
    }

    await showPageToast(
      TOAST_STATUS.DROPPING,
      `Uploading to ${folderResult.targetFolder || 'root'}...`,
      'loading',
      undefined,
      taskId
    )

    console.log(
      `Starting image upload for task ${taskId} to folder: ${folderResult.targetFolder || 'root'}`
    )

    try {
      const uploadResult = await handleImageUpload(info, folderResult.targetFolder)
      console.log(`Image upload handling completed for task ${taskId}`)

      if (!uploadResult) {
        console.log(`Upload failed for task ${taskId} (no success notification needed)`)
      } else {
        console.log(`Upload succeeded for task ${taskId} (no success notification needed)`)
      }
    } catch (uploadError) {
      console.error(`Upload failed for task ${taskId}:`, uploadError)
      throw uploadError
    }
  } catch (error) {
    console.error(`Error in processMenuClick for task ${taskId}:`, error)
    handleMenuClickError(error, info, taskId, retryCount, processMenuClick, tab)
  } finally {
    console.log(`processMenuClick END (retry=${retryCount})`)
  }
}
