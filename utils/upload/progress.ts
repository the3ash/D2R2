/**
 * Upload progress tracking and status updates
 */

import { UploadState, uploadTaskManager } from '../state'

// Upload stages
export type UploadStage = 'fetching' | 'compressing' | 'uploading' | 'processing'

// Map stage to UploadState
function stageToState(stage: UploadStage): UploadState {
  switch (stage) {
    case 'fetching':
      return UploadState.FETCHING
    case 'compressing':
      return UploadState.PROCESSING
    case 'uploading':
      return UploadState.UPLOADING
    case 'processing':
      return UploadState.PROCESSING
    default:
      return UploadState.LOADING
  }
}

// Stage display messages
const stageMessages: Record<UploadStage, string> = {
  fetching: 'Fetching image...',
  compressing: 'Compressing...',
  uploading: 'Uploading...',
  processing: 'Processing...',
}

/**
 * Update upload progress and notify content script
 * This keeps the toast alive by updating lastActivity timestamp
 */
export async function updateUploadProgress(
  uploadId: string,
  stage: UploadStage,
  tabId?: number
): Promise<void> {
  // Update task state in manager
  uploadTaskManager.updateTaskState(uploadId, stageToState(stage))

  // Get tabId from task if not provided
  const effectiveTabId = tabId || uploadTaskManager.getTaskTabId(uploadId)

  // Send message to content script to update lastActivity
  if (effectiveTabId) {
    try {
      await chrome.tabs.sendMessage(effectiveTabId, {
        action: 'updateUploadStatus',
        uploadId,
        stage,
        message: stageMessages[stage],
      })
    } catch {
      // Ignore errors - content script may not be loaded
      console.log(`Could not send progress update to tab ${effectiveTabId}`)
    }
  }
}

/**
 * Get stage display message
 */
export function getStageMessage(stage: UploadStage): string {
  return stageMessages[stage]
}
