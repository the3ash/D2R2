import {
  ExtensionStateManager,
  PageStateManager,
  UploadTaskManager,
} from "./managers";

// Export singleton instances of state managers
export const extensionStateManager = new ExtensionStateManager();
export const pageStateManager = new PageStateManager();
export const uploadTaskManager = new UploadTaskManager();

// Periodic cleanup of old tasks
setInterval(() => {
  uploadTaskManager.cleanupOldTasks();
}, 30 * 60 * 1000); // Run every 30 minutes

// Re-export types for convenience
export * from "./types";
