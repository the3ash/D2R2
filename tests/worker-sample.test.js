import { describe, expect, it, vi } from 'vitest'
import {
  allocateStoragePath,
  generatePublicUrl,
  isValidCloudflareId,
  validateImageFormat,
} from '../worker_sample.js'

describe('worker_sample helpers', () => {
  it('validates authorized Cloudflare account IDs', () => {
    const id = '0123456789abcdef0123456789abcdef'

    expect(isValidCloudflareId(id, id)).toBe(true)
    expect(isValidCloudflareId('not-an-id', id)).toBe(false)
    expect(isValidCloudflareId('ffffffffffffffffffffffffffffffff', id)).toBe(false)
  })

  it('detects supported image magic bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]).buffer
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]).buffer
    const text = new TextEncoder().encode('hello').buffer

    expect(validateImageFormat(jpeg)).toEqual({ valid: true, detectedType: 'image/jpeg' })
    expect(validateImageFormat(webp)).toEqual({ valid: true, detectedType: 'image/webp' })
    expect(validateImageFormat(text)).toEqual({ valid: false, detectedType: null })
  })

  it('keeps filenames and appends numeric suffixes to avoid overwrites', async () => {
    const occupied = new Set(['archive/photo.jpg', 'archive/photo_1.jpg'])
    const bucket = {
      head: vi.fn(async (key) => (occupied.has(key) ? {} : null)),
    }

    await expect(allocateStoragePath(bucket, 'archive', 'photo.jpg')).resolves.toBe(
      'archive/photo_2.jpg',
    )
    expect(bucket.head).toHaveBeenCalledTimes(3)
  })

  it('handles filenames without extensions', async () => {
    const occupied = new Set(['raw/name', 'raw/name_1'])
    const bucket = {
      head: vi.fn(async (key) => (occupied.has(key) ? {} : null)),
    }

    await expect(allocateStoragePath(bucket, 'raw', 'name')).resolves.toBe('raw/name_2')
  })

  it('generates public URLs from the configured R2 domain', () => {
    expect(generatePublicUrl({ R2_PUBLIC_DOMAIN: 'cdn.example.com' }, 'archive/photo.jpg')).toBe(
      'https://cdn.example.com/archive/photo.jpg',
    )
    expect(generatePublicUrl({}, 'archive/photo.jpg')).toBe(null)
  })
})
