// Image upload types and utilities

// Response from the Cloudflare worker
export interface UploadResponse {
  success: boolean
  url?: string
  path?: string
  size?: number
  type?: string
  error?: string
}

// Helper function to handle errors consistently
function handleError(error: unknown, context: string): string {
  console.error(`Error in ${context}:`, error)
  return error instanceof Error ? error.message : String(error)
}

// Helper function to create FormData for upload
function createFormData(
  cloudflareId: string,
  folderName: string | null,
  file: File | Blob,
  fileName?: string
): FormData {
  const formData = new FormData()
  formData.append('file', file, fileName)
  formData.append('cloudflareId', cloudflareId)
  if (folderName) {
    formData.append('folderName', folderName)
  }
  return formData
}

/**
 * Upload a blob directly to R2 storage
 */
export async function uploadImageBlob(
  workerUrl: string,
  cloudflareId: string,
  folderName: string | null,
  imageBlob: Blob,
  fileName: string
): Promise<UploadResponse> {
  try {
    const formData = createFormData(cloudflareId, folderName, imageBlob, fileName)
    const response = await fetch(workerUrl, { method: 'POST', body: formData })

    if (!response.ok) {
      return {
        success: false,
        error: `Worker responded with status: ${response.status}`,
      }
    }

    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'Blob upload'),
    }
  }
}
