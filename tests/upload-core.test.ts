import { describe, expect, it } from 'vitest'
import { createUploadFormData } from '../utils/upload/upload-core'

describe('createUploadFormData', () => {
  it('keeps the original URL filename for Worker-side naming policy', () => {
    const blob = new Blob(['image'], { type: 'image/jpeg' })

    const { formData, filename } = createUploadFormData(
      blob,
      'https://example.com/assets/photo.jpg?size=large',
      '0123456789abcdef0123456789abcdef',
      null,
    )

    const file = formData.get('file') as File
    expect(filename).toBe('photo.jpg')
    expect(file.name).toBe('photo.jpg')
    expect(formData.get('cloudflareId')).toBe('0123456789abcdef0123456789abcdef')
    expect(formData.has('folderName')).toBe(false)
  })

  it('falls back to a content-type extension when the URL has no filename', () => {
    const blob = new Blob(['image'], { type: 'image/webp' })

    const { filename } = createUploadFormData(
      blob,
      'https://example.com/',
      '0123456789abcdef0123456789abcdef',
      'moodboard',
    )

    expect(filename).toBe('downloaded-image.webp')
  })

  it('passes selected folder names to the Worker', () => {
    const blob = new Blob(['image'], { type: 'image/png' })

    const { formData } = createUploadFormData(
      blob,
      'https://example.com/photo.png',
      '0123456789abcdef0123456789abcdef',
      'archive',
    )

    expect(formData.get('folderName')).toBe('archive')
  })
})
