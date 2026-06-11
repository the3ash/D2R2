import { describe, expect, it } from 'vitest'
import { formatWorkerUrl } from '../utils/helpers/url'

describe('formatWorkerUrl', () => {
  it('adds https to host-only Worker URLs', () => {
    expect(formatWorkerUrl('worker.example.workers.dev')).toBe('https://worker.example.workers.dev')
  })

  it('keeps explicit http and https URLs unchanged', () => {
    expect(formatWorkerUrl('https://worker.example.workers.dev')).toBe(
      'https://worker.example.workers.dev',
    )
    expect(formatWorkerUrl('http://localhost:8787')).toBe('http://localhost:8787')
  })

  it('trims whitespace before formatting', () => {
    expect(formatWorkerUrl('  worker.example.workers.dev  ')).toBe(
      'https://worker.example.workers.dev',
    )
  })
})
