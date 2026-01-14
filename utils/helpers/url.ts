// Helper function: Ensure Worker URL is properly formatted
export function formatWorkerUrl(url: string): string {
  if (!url) return url
  const trimmedUrl = url.trim()
  return !trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')
    ? `https://${trimmedUrl}`
    : trimmedUrl
}
