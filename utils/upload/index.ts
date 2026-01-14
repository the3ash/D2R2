/**
 * Upload module exports
 */

// Main entry points
export { handleImageClick, handleImageUpload, processMenuClick } from './image-handler'

// Core upload functions (for potential reuse)
export {
  fetchImageData,
  createUploadFormData,
  uploadImageToServer,
  uploadImageWithRetry,
} from './upload-core'

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

// Handler utilities
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
