/**
 * Upload module exports
 */

// Main entry point - unified upload function
export { uploadImage } from './uploader'

// Progress tracking
export { updateUploadProgress, getStageMessage, type UploadStage } from './progress'

// Core upload functions (for potential reuse)
export { fetchImageData, createUploadFormData, uploadImageToServer, uploadImageWithRetry } from './upload-core'

// Retry utilities (for potential reuse)
export {
  ErrorCategory,
  NetworkCondition,
  classifyError,
  shouldRetry,
  calculateRetryDelay,
  estimateNetworkCondition,
  getEnhancedErrorMessage,
} from './retry'

// Handler utilities (kept for backward compatibility during migration)
export {
  validateConfig,
  handleSuccessfulUpload,
  handleFailedUpload,
  showLoadingToast,
  validateSourceUrl,
  determineTargetFolderWithConfig,
  generateUniqueId,
} from './handlers'

// Compression
export { maybeCompressImageBlob } from './compress'
