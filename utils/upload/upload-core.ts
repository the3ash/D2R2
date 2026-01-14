/**
 * Core upload functionality - image fetching and uploading
 */

import { UploadState, uploadTaskManager } from '../state'
import {
  ErrorCategory,
  classifyError,
  shouldRetry,
  estimateNetworkCondition,
  getEnhancedErrorMessage,
} from './retry'

// Fetch image data from URL
export async function fetchImageData(
  imageUrl: string,
  uploadId: string
): Promise<{ success: boolean; imageBlob?: Blob; error?: string }> {
  console.log('Starting to directly get image data from browser...')
  uploadTaskManager.updateTaskState(uploadId, UploadState.FETCHING)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const imageResponse = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
      },
      credentials: 'omit',
      cache: 'no-store',
      priority: 'high',
    })

    clearTimeout(timeoutId)

    if (!imageResponse.ok) {
      throw new Error(`Failed to get image: ${imageResponse.status} ${imageResponse.statusText}`)
    }

    const imageBlob = await imageResponse.blob()
    console.log(
      'Successfully got image data:',
      `Type=${imageBlob.type}, Size=${imageBlob.size} bytes`
    )

    if (!imageBlob.type.startsWith('image/')) {
      console.warn(`Got data is not image type: ${imageBlob.type}`)
    }

    return { success: true, imageBlob }
  } catch (fetchError) {
    console.error('Failed to get image data:', fetchError)
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError)

    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      uploadTaskManager.updateTaskState(
        uploadId,
        UploadState.ERROR,
        'Image fetch timed out after 15 seconds.'
      )
      return {
        success: false,
        error: 'Image fetch timed out after 15 seconds.',
      }
    }

    uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, errorMessage)
    return { success: false, error: errorMessage }
  }
}

// Create upload form data
export function createUploadFormData(
  imageBlob: Blob,
  imageUrlOrFilename: string,
  cloudflareId: string,
  folderPath: string | null
): { formData: FormData; filename: string } {
  let filename: string

  if (imageUrlOrFilename.startsWith('http')) {
    const urlObj = new URL(imageUrlOrFilename)
    const originalFilename = urlObj.pathname.split('/').pop() || ''
    const fileExtension =
      (originalFilename.includes('.')
        ? originalFilename.split('.').pop()
        : imageBlob.type.split('/').pop()) || 'jpg'

    const timestamp = Date.now()
    filename = `image_${timestamp}.${fileExtension}`
  } else {
    filename = imageUrlOrFilename
  }

  const formData = new FormData()
  formData.append('file', new File([imageBlob], filename, { type: imageBlob.type }))
  formData.append('cloudflareId', cloudflareId)

  if (folderPath) {
    formData.append('folderName', folderPath)
  }

  return { formData, filename }
}

// Upload image to server
export async function uploadImageToServer(
  formData: FormData,
  workerUrl: string,
  uploadId: string
): Promise<{
  success: boolean
  result?: any
  error?: string
  status?: number
}> {
  console.log(`Sending image data to Worker: ${workerUrl}`)
  uploadTaskManager.updateTaskState(uploadId, UploadState.UPLOADING)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(workerUrl, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: {
        Priority: 'high',
        'X-Upload-ID': uploadId,
        Connection: 'keep-alive',
      },
      cache: 'no-store',
    })

    clearTimeout(timeoutId)
    uploadTaskManager.updateTaskState(uploadId, UploadState.PROCESSING)

    const status = response.status

    if (!response.ok) {
      throw new Error(`Server responded with status: ${status}`)
    }

    const respText = await response.text()
    console.log('Worker response:', respText)

    try {
      const result = JSON.parse(respText)
      return { success: true, result, status }
    } catch (parseError) {
      console.error('Failed to parse response:', parseError)

      if (respText.includes('"success":true') && respText.includes('"url"')) {
        const urlMatch = respText.match(/"url"\s*:\s*"([^"]+)"/)
        if (urlMatch && urlMatch[1]) {
          return {
            success: true,
            result: { success: true, url: urlMatch[1] },
            status,
          }
        }
      }

      throw new Error('Response format error')
    }
  } catch (error) {
    console.error('Error handling response:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    let status: number | undefined

    const statusMatch = errorMessage.match(/status: (\d+)/)
    if (statusMatch && statusMatch[1]) {
      status = parseInt(statusMatch[1])
    }

    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      uploadTaskManager.updateTaskState(
        uploadId,
        UploadState.ERROR,
        'Upload timed out. Server might be busy.'
      )
      return {
        success: false,
        error: `Upload timed out after 30 seconds. Please try again.`,
        status,
      }
    }

    uploadTaskManager.updateTaskState(uploadId, UploadState.ERROR, errorMessage)
    return {
      success: false,
      error: `Error handling response: ${errorMessage}`,
      status,
    }
  }
}

// Upload image with retry logic
export async function uploadImageWithRetry(
  formData: FormData,
  workerUrl: string,
  uploadId: string,
  maxRetries = 3
): Promise<{ success: boolean; result?: any; error?: string }> {
  let retryCount = 0
  let lastError: string | undefined
  let lastStatus: number | undefined
  let recentErrors: ErrorCategory[] = []

  while (retryCount <= maxRetries) {
    try {
      if (retryCount > 0) {
        console.log(`Retry attempt ${retryCount}/${maxRetries} for upload ${uploadId}`)

        const errorObj = new Error(lastError || 'Unknown error')
        const retryDecision = shouldRetry(errorObj, retryCount, maxRetries, lastStatus)

        if (!retryDecision.retry) {
          console.log(`Not retrying: ${retryDecision.reason}`)
          break
        }

        uploadTaskManager.updateTaskState(
          uploadId,
          UploadState.UPLOADING,
          `Retry #${retryCount}... (${retryDecision.reason})`
        )

        console.log(`Waiting ${retryDecision.delay}ms before retry...`)
        await new Promise((r) => setTimeout(r, retryDecision.delay))
      }

      const result = await uploadImageToServer(formData, workerUrl, uploadId)

      if (result.success) {
        return result
      }

      lastError = result.error
      lastStatus = result.status

      const errorCategory = classifyError(lastError || 'Unknown error', lastStatus)
      recentErrors.push(errorCategory)

      if (errorCategory === ErrorCategory.PERMANENT) {
        console.log(`Permanent error detected, not retrying: ${lastError}`)
        break
      }

      retryCount++
    } catch (error) {
      retryCount++
      lastError = error instanceof Error ? error.message : String(error)

      const errorCategory = classifyError(lastError)
      recentErrors.push(errorCategory)

      console.warn(`Upload attempt ${retryCount} failed with ${errorCategory} error: ${lastError}`)
    }
  }

  const networkCondition = estimateNetworkCondition(recentErrors)
  console.log(`Upload failed after ${retryCount} attempts. Network condition: ${networkCondition}`)

  return {
    success: false,
    error: getEnhancedErrorMessage(lastError, retryCount, maxRetries, networkCondition, lastStatus),
  }
}
