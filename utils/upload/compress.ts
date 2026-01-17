import { UploadState, uploadTaskManager } from '../state'

export async function maybeCompressImageBlob(imageBlob: Blob, quality: number, uploadId: string): Promise<Blob> {
  if (!Number.isFinite(quality) || quality <= 0) return imageBlob

  const rawContentType = imageBlob.type || ''
  const normalizedContentType = rawContentType.split(';')[0]?.trim().toLowerCase()
  const contentType = normalizedContentType === 'image/jpg' ? 'image/jpeg' : normalizedContentType

  const isCompressibleType = contentType === 'image/jpeg' || contentType === 'image/webp'
  if (!isCompressibleType) {
    console.log(`Image compression skipped: unsupported type "${rawContentType || 'unknown'}"`)
    return imageBlob
  }

  const clampedQuality = Math.min(0.95, Math.max(0.1, quality))
  if (clampedQuality >= 0.95) return imageBlob

  try {
    uploadTaskManager.updateTaskState(uploadId, UploadState.PROCESSING, 'Compressing image...')

    const bitmap = await (async () => {
      try {
        return await createImageBitmap(imageBlob, {
          imageOrientation: 'from-image',
        } as unknown as ImageBitmapOptions)
      } catch {
        return await createImageBitmap(imageBlob)
      }
    })()

    try {
      if (!('OffscreenCanvas' in globalThis)) {
        console.warn('Image compression skipped: OffscreenCanvas is not available in this context')
        return imageBlob
      }

      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      if (!('convertToBlob' in canvas)) {
        console.warn('Image compression skipped: OffscreenCanvas.convertToBlob is not available')
        return imageBlob
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return imageBlob

      ctx.drawImage(bitmap, 0, 0)

      const compressed = await canvas.convertToBlob({
        type: contentType,
        quality: clampedQuality,
      })

      if (compressed.size > 0 && compressed.size < imageBlob.size) {
        console.log(`Compressed ${contentType}: ${imageBlob.size} -> ${compressed.size} bytes (q=${clampedQuality})`)
        return compressed
      }

      console.log(
        `Image compression skipped: output not smaller (${imageBlob.size} -> ${compressed.size} bytes, q=${clampedQuality})`
      )
      return imageBlob
    } finally {
      bitmap.close()
    }
  } catch (error) {
    console.warn('Image compression failed, uploading original', error)
    return imageBlob
  }
}
