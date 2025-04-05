// Extension state machine
export enum ExtensionState {
  UNINITIALIZED = "uninitialized",
  INITIALIZING = "initializing",
  READY = "ready",
  ERROR = "error",
}

// Upload state machine
export enum UploadState {
  IDLE = "idle",
  PENDING = "pending",
  LOADING = "loading",
  FETCHING = "fetching",
  UPLOADING = "uploading",
  PROCESSING = "processing",
  SUCCESS = "success",
  ERROR = "error",
}

// Toast type
export type ToastType = "success" | "error" | "info" | "loading";

// Toast status constants
export const TOAST_STATUS = {
  DROPPING: "Dropping",
  DONE: "Done",
  FAILED: "Failed",
};
