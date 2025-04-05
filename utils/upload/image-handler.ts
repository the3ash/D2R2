import { TOAST_STATUS } from "../state/types";
import {
  UploadState,
  uploadTaskManager,
  extensionStateManager,
} from "../state";
import {
  showNotification,
  showPageToast,
  showProcessingNotification,
} from "../notifications";
import { formatWorkerUrl } from "../helpers/url";
import { handleError } from "../helpers/logger";
import { getConfig } from "../storage";
import {
  parseFolderPath,
  ROOT_FOLDER_ID,
  FOLDER_PREFIX,
  PARENT_MENU_ID,
} from "../menu";

// Constants for chunked upload
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MAX_CONCURRENT_CHUNKS = 3; // Maximum number of concurrent chunk uploads
const CHUNKED_UPLOAD_THRESHOLD = 2 * 1024 * 1024; // Only use chunked upload for files larger than 2MB

// Error types classification for retry decision
enum ErrorCategory {
  TEMPORARY = "temporary", // Temporary errors that should be retried
  PERMANENT = "permanent", // Permanent errors that should not be retried
  RATE_LIMIT = "rate_limit", // Rate limit errors requiring special handling
  TIMEOUT = "timeout", // Timeout errors
  UNKNOWN = "unknown", // Unclassified errors
}

// Network condition status
enum NetworkCondition {
  GOOD = "good", // Fast, reliable connection
  DEGRADED = "degraded", // Slow but working connection
  POOR = "poor", // Very slow, unreliable connection
  OFFLINE = "offline", // No connection
}

// Classify error types for retry decisions
function classifyError(error: Error | string, status?: number): ErrorCategory {
  const errorMessage = typeof error === "string" ? error : error.message;

  // Network related temporary errors that should be retried
  if (
    errorMessage.includes("network") ||
    errorMessage.includes("connection") ||
    errorMessage.includes("socket") ||
    errorMessage.includes("ECONNRESET") ||
    errorMessage.includes("ETIMEDOUT") ||
    errorMessage.includes("ENOTFOUND")
  ) {
    return ErrorCategory.TEMPORARY;
  }

  // Timeout errors
  if (
    errorMessage.includes("timeout") ||
    errorMessage.includes("abort") ||
    errorMessage.includes("timed out")
  ) {
    return ErrorCategory.TIMEOUT;
  }

  // Rate limit errors
  if (
    errorMessage.includes("rate limit") ||
    errorMessage.includes("too many requests") ||
    status === 429
  ) {
    return ErrorCategory.RATE_LIMIT;
  }

  // Permanent errors that should not be retried
  if (
    errorMessage.includes("not found") ||
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("forbidden") ||
    errorMessage.includes("bad request") ||
    errorMessage.includes("invalid") ||
    (status &&
      (status === 400 || status === 401 || status === 403 || status === 404))
  ) {
    return ErrorCategory.PERMANENT;
  }

  // Default to unknown
  return ErrorCategory.UNKNOWN;
}

// Estimate network condition based on recent request performance
function estimateNetworkCondition(
  recentErrors: ErrorCategory[] = []
): NetworkCondition {
  // Count different types of errors to gauge network reliability
  const timeoutCount = recentErrors.filter(
    (e) => e === ErrorCategory.TIMEOUT
  ).length;
  const temporaryErrorCount = recentErrors.filter(
    (e) => e === ErrorCategory.TEMPORARY
  ).length;

  if (timeoutCount >= 2 || temporaryErrorCount >= 3) {
    return NetworkCondition.POOR;
  } else if (timeoutCount === 1 || temporaryErrorCount >= 1) {
    return NetworkCondition.DEGRADED;
  } else if (navigator.onLine === false) {
    return NetworkCondition.OFFLINE;
  } else {
    return NetworkCondition.GOOD;
  }
}

// Calculate optimal retry delay based on retry count, error type and network condition
function calculateRetryDelay(
  retryCount: number,
  errorCategory: ErrorCategory,
  networkCondition: NetworkCondition
): number {
  // Base delay with exponential backoff
  let baseDelay = Math.min(1000 * Math.pow(2, retryCount), 30000);

  // Add jitter to prevent thundering herd problem
  const jitter = Math.random() * 0.3 * baseDelay;
  baseDelay = baseDelay + jitter;

  // Adjust based on error type
  switch (errorCategory) {
    case ErrorCategory.RATE_LIMIT:
      // Rate limits need longer backoff
      return baseDelay * 2;
    case ErrorCategory.TIMEOUT:
      // Timeout errors might need more time
      return baseDelay * 1.5;
    case ErrorCategory.TEMPORARY:
      return baseDelay;
    case ErrorCategory.PERMANENT:
      // No retry for permanent errors, but we return a value anyway
      return 0;
    default:
      return baseDelay;
  }
}

// Determine if a request should be retried based on error type and retry count
function shouldRetry(
  error: Error | string,
  retryCount: number,
  maxRetries: number,
  responseStatus?: number
): { retry: boolean; delay: number; reason: string } {
  // Never retry if we've hit the max
  if (retryCount >= maxRetries) {
    return {
      retry: false,
      delay: 0,
      reason: `Maximum retry count (${maxRetries}) reached`,
    };
  }

  // Classify the error
  const errorCategory = classifyError(error, responseStatus);

  // Don't retry permanent errors
  if (errorCategory === ErrorCategory.PERMANENT) {
    return {
      retry: false,
      delay: 0,
      reason: `Error is permanent and cannot be resolved with retry: ${
        typeof error === "string" ? error : error.message
      }`,
    };
  }

  // Get network condition state
  const networkCondition = estimateNetworkCondition([errorCategory]);

  // Don't retry if we're completely offline (except for the first retry)
  if (networkCondition === NetworkCondition.OFFLINE && retryCount > 0) {
    return { retry: false, delay: 0, reason: "Device appears to be offline" };
  }

  // Calculate delay
  const delay = calculateRetryDelay(
    retryCount,
    errorCategory,
    networkCondition
  );

  return {
    retry: true,
    delay,
    reason: `Retrying after ${errorCategory} error with ${networkCondition} network`,
  };
}

// Validate configuration for image upload
async function validateConfig(
  uploadId: string
): Promise<{ valid: boolean; config?: any }> {
  console.log("Getting configuration...");
  uploadTaskManager.updateTaskState(uploadId, UploadState.LOADING);
  const config = await getConfig();

  // Check configuration
  if (!config.cloudflareId || !config.workerUrl) {
    console.error(
      "Configuration error: Missing required Cloudflare ID or Worker URL"
    );
    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.ERROR,
      "Missing configuration"
    );
    showNotification(
      TOAST_STATUS.FAILED,
      "Please complete extension configuration",
      "error"
    );
    chrome.runtime.openOptionsPage();
    return { valid: false };
  }

  return { valid: true, config };
}

// Fetch image data from URL
async function fetchImageData(
  imageUrl: string,
  uploadId: string
): Promise<{ success: boolean; imageBlob?: Blob; error?: string }> {
  console.log("Starting to directly get image data from browser...");
  uploadTaskManager.updateTaskState(uploadId, UploadState.FETCHING);

  try {
    // Add timeout control and optimize request headers
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

    const imageResponse = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        // Add standard browser headers to reduce likelihood of being blocked
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
      // Don't send cookies for cross-origin requests
      credentials: "omit",
      // Disable caching
      cache: "no-store",
      // Set high priority to improve network request priority
      priority: "high",
    });

    clearTimeout(timeoutId);

    if (!imageResponse.ok) {
      throw new Error(
        `Failed to get image: ${imageResponse.status} ${imageResponse.statusText}`
      );
    }

    // Optimize Blob retrieval using stream processing
    const imageBlob = await imageResponse.blob();
    console.log(
      "Successfully got image data:",
      `Type=${imageBlob.type}, Size=${imageBlob.size} bytes`
    );

    // Check if it's really an image type
    if (!imageBlob.type.startsWith("image/")) {
      console.warn(`Got data is not image type: ${imageBlob.type}`);
    }

    return { success: true, imageBlob };
  } catch (fetchError) {
    console.error("Failed to get image data:", fetchError);
    const errorMessage =
      fetchError instanceof Error ? fetchError.message : String(fetchError);

    // Special handling for timeout errors
    if (errorMessage.includes("abort") || errorMessage.includes("timeout")) {
      uploadTaskManager.updateTaskState(
        uploadId,
        UploadState.ERROR,
        "Image fetch timed out after 15 seconds."
      );

      return {
        success: false,
        error: "Image fetch timed out after 15 seconds.",
      };
    }

    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.ERROR,
      errorMessage
    );

    return { success: false, error: errorMessage };
  }
}

// Split blob into chunks for upload
function splitBlobIntoChunks(
  blob: Blob,
  chunkSize: number = CHUNK_SIZE
): Blob[] {
  const chunks: Blob[] = [];
  let start = 0;

  while (start < blob.size) {
    const end = Math.min(start + chunkSize, blob.size);
    chunks.push(blob.slice(start, end));
    start = end;
  }

  console.log(
    `Split ${blob.size} byte blob into ${chunks.length} chunks of ~${chunkSize} bytes each`
  );
  return chunks;
}

// Upload image to server using chunked upload for large files
async function uploadImageChunked(
  imageBlob: Blob,
  filename: string,
  workerUrl: string,
  cloudflareId: string,
  folderPath: string | null,
  uploadId: string
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    // Check if file is large enough to benefit from chunked upload
    if (imageBlob.size <= CHUNKED_UPLOAD_THRESHOLD) {
      console.log(
        `File size (${imageBlob.size} bytes) below chunked threshold, using standard upload`
      );
      const formData = createUploadFormData(
        imageBlob,
        filename,
        cloudflareId,
        folderPath
      );
      return await uploadImageWithRetry(formData.formData, workerUrl, uploadId);
    }

    console.log(
      `Starting chunked upload for ${filename} (${imageBlob.size} bytes)`
    );
    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.UPLOADING,
      "Preparing chunks..."
    );

    // Split the file into chunks
    const chunks = splitBlobIntoChunks(imageBlob);
    const totalChunks = chunks.length;

    // Create a unique upload session ID for this chunked upload
    const sessionId = `${uploadId}_${Date.now()}`;

    // Track progress for UI updates
    let completedChunks = 0;

    // Upload chunks in parallel with concurrency limit
    const results = [];
    for (let i = 0; i < totalChunks; i += MAX_CONCURRENT_CHUNKS) {
      const chunkBatch = chunks.slice(i, i + MAX_CONCURRENT_CHUNKS);
      const chunkPromises = chunkBatch.map((chunk, index) => {
        const chunkIndex = i + index;
        return uploadSingleChunk(
          chunk,
          chunkIndex,
          totalChunks,
          sessionId,
          filename,
          workerUrl,
          cloudflareId,
          folderPath,
          uploadId,
          () => {
            completedChunks++;
            const progress = Math.round((completedChunks / totalChunks) * 100);
            uploadTaskManager.updateTaskState(
              uploadId,
              UploadState.UPLOADING,
              `Uploading... ${progress}% (${completedChunks}/${totalChunks})`
            );
          }
        );
      });

      // Wait for the current batch to complete before starting next batch
      const batchResults = await Promise.all(chunkPromises);
      results.push(...batchResults);

      // Check if any chunk failed
      const failedChunk = results.find((r) => !r.success);
      if (failedChunk) {
        throw new Error(`Chunk upload failed: ${failedChunk.error}`);
      }
    }

    // All chunks uploaded successfully, now tell the server to combine them
    console.log(
      `All ${totalChunks} chunks uploaded successfully, finalizing...`
    );
    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.PROCESSING,
      "Finalizing upload..."
    );

    // Request to finalize the chunked upload
    const finalizeData = new FormData();
    finalizeData.append("action", "finalize_chunked_upload");
    finalizeData.append("sessionId", sessionId);
    finalizeData.append("totalChunks", totalChunks.toString());
    finalizeData.append("filename", filename);
    finalizeData.append("cloudflareId", cloudflareId);
    if (folderPath) {
      finalizeData.append("folderName", folderPath);
    }

    const finalizeResponse = await fetch(workerUrl, {
      method: "POST",
      body: finalizeData,
      headers: {
        Priority: "high",
        "X-Upload-ID": uploadId,
      },
      cache: "no-store",
    });

    const finalizeResult = await finalizeResponse.json();
    if (!finalizeResult.success) {
      throw new Error(
        `Failed to finalize chunked upload: ${finalizeResult.error}`
      );
    }

    console.log(`Chunked upload completed successfully: ${finalizeResult.url}`);
    return { success: true, result: finalizeResult };
  } catch (error) {
    console.error("Error in chunked upload:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.ERROR,
      `Chunked upload failed: ${errorMessage}`
    );

    return {
      success: false,
      error: `Chunked upload error: ${errorMessage}`,
    };
  }
}

// Upload a single chunk with enhanced error handling
async function uploadSingleChunk(
  chunk: Blob,
  chunkIndex: number,
  totalChunks: number,
  sessionId: string,
  filename: string,
  workerUrl: string,
  cloudflareId: string,
  folderPath: string | null,
  uploadId: string,
  onProgress: () => void
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(
      `Uploading chunk ${chunkIndex + 1}/${totalChunks} (${chunk.size} bytes)`
    );

    // Setup abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    // Create form data for this chunk
    const formData = new FormData();
    formData.append("action", "upload_chunk");
    formData.append("sessionId", sessionId);
    formData.append("chunkIndex", chunkIndex.toString());
    formData.append("totalChunks", totalChunks.toString());
    formData.append("filename", filename);
    formData.append("cloudflareId", cloudflareId);
    formData.append("file", new File([chunk], `${filename}.part${chunkIndex}`));
    if (folderPath) {
      formData.append("folderName", folderPath);
    }

    // Add retries for individual chunks
    let retryCount = 0;
    const maxRetries = 3;
    let lastStatus: number | undefined;
    let recentErrors: ErrorCategory[] = [];

    while (retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          // Get error category from last error
          const errorCategory =
            recentErrors[recentErrors.length - 1] || ErrorCategory.UNKNOWN;

          // Calculate network condition
          const networkCondition = estimateNetworkCondition(recentErrors);

          // Calculate retry delay with intelligent algorithm
          const delay = calculateRetryDelay(
            retryCount,
            errorCategory,
            networkCondition
          );

          console.log(
            `Retry ${retryCount} for chunk ${chunkIndex + 1}/${totalChunks} ` +
              `(${errorCategory} error, ${networkCondition} network, ${delay}ms delay)`
          );

          // Wait with calculated delay
          await new Promise((r) => setTimeout(r, delay));
        }

        const response = await fetch(workerUrl, {
          method: "POST",
          body: formData,
          signal: controller.signal,
          headers: {
            Priority: "high",
            "X-Upload-ID": uploadId,
            "X-Chunk-Index": chunkIndex.toString(),
            Connection: "keep-alive",
          },
          cache: "no-store",
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || "Unknown chunk upload error");
        }

        // Chunk uploaded successfully
        onProgress();
        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Classify error
        const errorCategory = classifyError(errorMessage, lastStatus);
        recentErrors.push(errorCategory);

        // Don't retry permanent errors
        if (errorCategory === ErrorCategory.PERMANENT) {
          console.log(
            `Permanent error for chunk ${
              chunkIndex + 1
            }, not retrying: ${errorMessage}`
          );
          return {
            success: false,
            error: `Permanent error for chunk ${
              chunkIndex + 1
            }: ${errorMessage}`,
          };
        }

        retryCount++;
        console.error(
          `Error uploading chunk ${
            chunkIndex + 1
          }/${totalChunks} (attempt ${retryCount}, ${errorCategory}):`,
          error
        );

        if (retryCount > maxRetries) {
          const networkCondition = estimateNetworkCondition(recentErrors);
          return {
            success: false,
            error: `Failed to upload chunk ${
              chunkIndex + 1
            } after ${maxRetries} retries. Network: ${networkCondition}`,
          };
        }
      }
    }

    // This should not be reached due to the return in the catch block
    return { success: false, error: "Unknown chunk upload error" };
  } catch (error) {
    console.error(
      `Error in uploadSingleChunk for chunk ${chunkIndex + 1}/${totalChunks}:`,
      error
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Create upload form data (modified to accept filename directly)
function createUploadFormData(
  imageBlob: Blob,
  imageUrlOrFilename: string,
  cloudflareId: string,
  folderPath: string | null
): { formData: FormData; filename: string } {
  let filename: string;

  // Check if the input is a URL or already a filename
  if (imageUrlOrFilename.startsWith("http")) {
    // Generate file name (based on original URL and timestamp)
    const urlObj = new URL(imageUrlOrFilename);
    const originalFilename = urlObj.pathname.split("/").pop() || "";
    const fileExtension =
      (originalFilename.includes(".")
        ? originalFilename.split(".").pop()
        : imageBlob.type.split("/").pop()) || "jpg";

    const timestamp = Date.now();
    filename = `image_${timestamp}.${fileExtension}`;
  } else {
    // Already a filename
    filename = imageUrlOrFilename;
  }

  // Create FormData and add file
  const formData = new FormData();
  formData.append(
    "file",
    new File([imageBlob], filename, { type: imageBlob.type })
  );
  formData.append("cloudflareId", cloudflareId);

  // Add folder information (if any)
  if (folderPath) {
    formData.append("folderName", folderPath);
  }

  return { formData, filename };
}

// Upload image to server with enhanced error handling and retry logic
async function uploadImageToServer(
  formData: FormData,
  workerUrl: string,
  uploadId: string
): Promise<{
  success: boolean;
  result?: any;
  error?: string;
  status?: number;
}> {
  console.log(`Sending image data to Worker: ${workerUrl}`);
  uploadTaskManager.updateTaskState(uploadId, UploadState.UPLOADING);

  try {
    // Add timeout and optimize request headers
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    const response = await fetch(workerUrl, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      headers: {
        // Add optimized request headers to improve priority
        Priority: "high",
        "X-Upload-ID": uploadId,
        Connection: "keep-alive",
      },
      // Disable fetch's default caching mechanism
      cache: "no-store",
    });

    clearTimeout(timeoutId); // Clear timeout timer

    // Update state to show processing response
    uploadTaskManager.updateTaskState(uploadId, UploadState.PROCESSING);

    // Return status code for retry decision making
    const status = response.status;

    if (!response.ok) {
      throw new Error(`Server responded with status: ${status}`);
    }

    const respText = await response.text();
    console.log("Worker response:", respText);

    try {
      const result = JSON.parse(respText);
      return { success: true, result, status };
    } catch (parseError) {
      console.error("Failed to parse response:", parseError);

      // Try extracting URL from text
      if (respText.includes('"success":true') && respText.includes('"url"')) {
        const urlMatch = respText.match(/"url"\s*:\s*"([^"]+)"/);
        if (urlMatch && urlMatch[1]) {
          return {
            success: true,
            result: {
              success: true,
              url: urlMatch[1],
            },
            status,
          };
        }
      }

      throw new Error("Response format error");
    }
  } catch (error) {
    console.error("Error handling response:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    let status: number | undefined;

    // Extract status code if present in error message
    const statusMatch = errorMessage.match(/status: (\d+)/);
    if (statusMatch && statusMatch[1]) {
      status = parseInt(statusMatch[1]);
    }

    // Special handling for timeout errors
    if (errorMessage.includes("abort") || errorMessage.includes("timeout")) {
      uploadTaskManager.updateTaskState(
        uploadId,
        UploadState.ERROR,
        "Upload timed out. Server might be busy."
      );

      return {
        success: false,
        error: `Upload timed out after 30 seconds. Please try again.`,
        status,
      };
    }

    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.ERROR,
      errorMessage
    );

    return {
      success: false,
      error: `Error handling response: ${errorMessage}`,
      status,
    };
  }
}

// Upload image with intelligent retry logic
async function uploadImageWithRetry(
  formData: FormData,
  workerUrl: string,
  uploadId: string,
  maxRetries = 3
): Promise<{ success: boolean; result?: any; error?: string }> {
  let retryCount = 0;
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let recentErrors: ErrorCategory[] = [];

  while (retryCount <= maxRetries) {
    try {
      // Show retry status on UI if this is a retry
      if (retryCount > 0) {
        console.log(
          `Retry attempt ${retryCount}/${maxRetries} for upload ${uploadId}`
        );

        // Get retry decision with intelligent delay calculation
        const errorObj = new Error(lastError || "Unknown error");
        const retryDecision = shouldRetry(
          errorObj,
          retryCount,
          maxRetries,
          lastStatus
        );

        if (!retryDecision.retry) {
          console.log(`Not retrying: ${retryDecision.reason}`);
          break;
        }

        uploadTaskManager.updateTaskState(
          uploadId,
          UploadState.UPLOADING,
          `Retry #${retryCount}... (${retryDecision.reason})`
        );

        // Wait for the calculated delay
        console.log(`Waiting ${retryDecision.delay}ms before retry...`);
        await new Promise((r) => setTimeout(r, retryDecision.delay));
      }

      // Attempt the upload
      const result = await uploadImageToServer(formData, workerUrl, uploadId);

      // If successful, return the result
      if (result.success) {
        return result;
      }

      // Handle failed upload with status information
      lastError = result.error;
      lastStatus = result.status;

      // Classify this error for network condition estimation
      const errorCategory = classifyError(
        lastError || "Unknown error",
        lastStatus
      );
      recentErrors.push(errorCategory);

      // Permanent errors should not be retried
      if (errorCategory === ErrorCategory.PERMANENT) {
        console.log(`Permanent error detected, not retrying: ${lastError}`);
        break;
      }

      retryCount++;
    } catch (error) {
      retryCount++;
      lastError = error instanceof Error ? error.message : String(error);

      // Classify this error for network condition estimation
      const errorCategory = classifyError(lastError);
      recentErrors.push(errorCategory);

      console.warn(
        `Upload attempt ${retryCount} failed with ${errorCategory} error: ${lastError}`
      );
    }
  }

  // We've either exhausted retries or hit a permanent error
  const networkCondition = estimateNetworkCondition(recentErrors);
  console.log(
    `Upload failed after ${retryCount} attempts. Network condition: ${networkCondition}`
  );

  return {
    success: false,
    error: getEnhancedErrorMessage(
      lastError,
      retryCount,
      maxRetries,
      networkCondition,
      lastStatus
    ),
  };
}

// Generate a more helpful error message based on diagnostics
function getEnhancedErrorMessage(
  errorMessage: string | undefined,
  retryCount: number,
  maxRetries: number,
  networkCondition: NetworkCondition,
  status?: number
): string {
  if (!errorMessage) return "Unknown upload error";

  let enhancedMessage = `Failed after ${retryCount} retries.`;

  // Add network condition info
  if (networkCondition !== NetworkCondition.GOOD) {
    enhancedMessage += ` Network appears to be ${networkCondition}.`;
  }

  // Add specific guidance based on status code
  if (status) {
    if (status === 413) {
      enhancedMessage += " The image may be too large for the server.";
    } else if (status === 429) {
      enhancedMessage += " Server rate limit reached. Please try again later.";
    } else if (status >= 500) {
      enhancedMessage += " Server is experiencing problems.";
    }
  }

  // Add the original error message
  enhancedMessage += ` Error: ${errorMessage}`;

  return enhancedMessage;
}

// Process successful upload
async function handleSuccessfulUpload(
  result: any,
  uploadId: string,
  notificationId?: string
): Promise<void> {
  try {
    console.log(`Successfully uploaded image: ${result.url}`);

    // Try to copy URL to clipboard if available
    if (result.url && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(result.url);
        console.log("URL copied to clipboard");
      } catch (clipboardError) {
        console.warn("Could not copy URL to clipboard:", clipboardError);
      }
    }

    // Update task state to success
    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.SUCCESS,
      "" // Third parameter is required, passing empty string
    );

    // Show success notification
    await showPageToast(
      TOAST_STATUS.DONE,
      "Upload complete!",
      "success",
      result.url,
      notificationId // Use the same ID to replace loading notification
    );

    console.log(`Upload task ${uploadId} completed successfully`);
  } catch (error) {
    console.error(
      `Error in handleSuccessfulUpload for task ${uploadId}:`,
      error
    );
  }
}

// Process failed upload
async function handleFailedUpload(
  errorMessage: string = "Unknown error",
  uploadId: string,
  notificationId?: string
): Promise<void> {
  try {
    console.error(`Upload failed for task ${uploadId}: ${errorMessage}`);

    let displayMessage = "Upload failed";

    // Customize error message based on type
    if (errorMessage.includes("network")) {
      displayMessage = "Network error. Please check your connection.";
    } else if (errorMessage.includes("timeout")) {
      displayMessage = "Upload timed out. Please try again.";
    } else if (errorMessage.includes("large")) {
      displayMessage = "Image is too large. Max size is 5MB.";
    } else if (errorMessage) {
      // Use the error message but limit length
      displayMessage = `Error: ${errorMessage.substring(0, 100)}${
        errorMessage.length > 100 ? "..." : ""
      }`;
    }

    // Update task state to error
    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.ERROR,
      displayMessage // Third parameter is required
    );

    // Show failure notification
    await showPageToast(
      TOAST_STATUS.FAILED,
      displayMessage,
      "error",
      undefined,
      notificationId // Use the same ID to replace loading notification
    );

    console.log(`Upload task ${uploadId} failed: ${displayMessage}`);
  } catch (error) {
    console.error(`Error in handleFailedUpload for task ${uploadId}:`, error);
  }
}

// Shows loading toast
async function showLoadingToast(uploadId: string): Promise<void> {
  await showPageToast(
    TOAST_STATUS.DROPPING,
    "Dropping",
    "loading",
    undefined,
    uploadId
  );
}

// Handle context menu click
export async function handleImageClick(
  info: chrome.contextMenus.OnClickData,
  targetFolder?: string | null
) {
  console.log("Starting image upload...");

  if (!info.srcUrl) {
    console.error("Error: Unable to get image URL");
    showNotification(TOAST_STATUS.FAILED, "Unable to get image URL", "error");
    return;
  }

  // Create a new upload task
  const uploadId = uploadTaskManager.createTask(info, targetFolder);

  try {
    // Log request details (useful for debugging and error reporting)
    console.log(
      JSON.stringify({
        operation: "imageUpload",
        imageUrl: info.srcUrl.substring(0, 100) + "...",
        targetFolder: targetFolder || "(Upload to root directory)",
        taskId: uploadId,
      })
    );

    // Validate configuration
    const configResult = await validateConfig(uploadId);
    if (!configResult.valid) return;
    const config = configResult.config;

    // Use the provided targetFolder or default value
    const folderPath = targetFolder || null;
    uploadTaskManager.setTaskFolder(uploadId, folderPath);

    // Show upload start toast (loading state)
    await showLoadingToast(uploadId);

    // Use Promise.all for parallel processing of image fetching and configuration
    const [imageDataResult] = await Promise.all([
      fetchImageData(info.srcUrl, uploadId),
      // Add other parallel processing tasks here if needed
    ]);

    if (!imageDataResult.success) {
      // Show error toast
      await showPageToast(
        TOAST_STATUS.FAILED,
        `Failed to get image: ${imageDataResult.error}`,
        "error",
        undefined,
        uploadId
      );
      return;
    }

    // Update toast to show processing state
    uploadTaskManager.updateTaskState(uploadId, UploadState.PROCESSING);
    await showLoadingToast(uploadId);

    // Generate filename
    const urlObj = new URL(info.srcUrl);
    const originalFilename = urlObj.pathname.split("/").pop() || "";
    const fileExtension =
      (originalFilename.includes(".")
        ? originalFilename.split(".").pop()
        : imageDataResult.imageBlob!.type.split("/").pop()) || "jpg";
    const timestamp = Date.now();
    const filename = `image_${timestamp}.${fileExtension}`;

    // Ensure Worker URL is properly formatted
    const formattedWorkerUrl = formatWorkerUrl(config.workerUrl);

    // Update toast to show sending
    await showLoadingToast(uploadId);

    // Use chunked upload for large files
    let uploadResult;
    if (imageDataResult.imageBlob!.size > CHUNKED_UPLOAD_THRESHOLD) {
      console.log(
        `Using chunked upload for large file: ${
          imageDataResult.imageBlob!.size
        } bytes`
      );
      uploadResult = await uploadImageChunked(
        imageDataResult.imageBlob!,
        filename,
        formattedWorkerUrl,
        config.cloudflareId,
        folderPath,
        uploadId
      );
    } else {
      // Small file, use regular upload
      console.log(
        `Using regular upload for small file: ${
          imageDataResult.imageBlob!.size
        } bytes`
      );
      const { formData } = createUploadFormData(
        imageDataResult.imageBlob!,
        info.srcUrl,
        config.cloudflareId,
        folderPath
      );

      // Add important request headers to improve priority
      formData.append("priority", "high");
      formData.append("timestamp", Date.now().toString());

      uploadResult = await uploadImageWithRetry(
        formData,
        formattedWorkerUrl,
        uploadId
      );
    }

    // Process upload result
    if (uploadResult.success && uploadResult.result.success) {
      await handleSuccessfulUpload(uploadResult.result, uploadId);
    } else {
      await handleFailedUpload(
        uploadResult.error || uploadResult.result?.error,
        uploadId
      );
    }
  } catch (error) {
    console.error("Error handling upload:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.ERROR,
      errorMessage
    );

    // Update toast to error state
    await showPageToast(
      TOAST_STATUS.FAILED,
      `Error occurred during upload: ${errorMessage}`,
      "error",
      undefined,
      uploadId
    );
  }
}

// Handle image upload
export async function handleImageUpload(
  info: chrome.contextMenus.OnClickData,
  targetFolder: string | null = null
): Promise<boolean> {
  // Generate a unique ID for this upload task
  const uploadId = generateUniqueId();
  console.log(`Starting image upload task: ${uploadId}`);

  try {
    // Track this task in the upload manager
    uploadTaskManager.createTask(info, targetFolder);

    // Show processing notification with task ID
    const notificationId = showProcessingNotification(info, "Processing image");
    console.log(`Created processing notification: ${notificationId}`);

    // Quick parallel check of extension initialization status and configuration
    const initPromise = new Promise<boolean>(async (resolve) => {
      // Check if extension is fully initialized
      if (!extensionStateManager.isReady()) {
        console.log(
          "Extension not fully initialized, will queue upload and wait"
        );

        // Update notification
        showProcessingNotification(
          info,
          "Added to queue, will be processed when extension is fully initialized"
        );

        // Wait for initialization with a timeout
        let waitCount = 0;
        const maxWaitCount = 10; // Maximum number of wait cycles

        while (!extensionStateManager.isReady() && waitCount < maxWaitCount) {
          waitCount++;
          console.log(`Waiting for extension initialization... (${waitCount})`);
          await new Promise((r) => setTimeout(r, 500));

          if (waitCount % 3 === 0) {
            // Update notification every 3 cycles
            showProcessingNotification(
              info,
              `Waiting for extension (attempt ${waitCount})...`
            );
          }
        }

        // Check again
        if (!extensionStateManager.isReady()) {
          uploadTaskManager.updateTaskState(
            uploadId,
            UploadState.ERROR,
            "Extension initialization failed"
          );
          await showPageToast(
            TOAST_STATUS.FAILED,
            "Extension initialization failed, please reload the extension",
            "error",
            undefined,
            notificationId // Use the same ID to replace the loading notification
          );
          resolve(false);
          return;
        } else {
          // Initialized, update status
          uploadTaskManager.updateTaskState(uploadId, UploadState.LOADING, "");
          showProcessingNotification(
            info,
            "Extension initialized, proceeding with upload..."
          );
        }
      }
      resolve(true);
    });

    // Parallel configuration fetching
    const configPromise = getConfig();

    // Wait for initialization and configuration
    const [initSuccess, config] = await Promise.all([
      initPromise,
      configPromise,
    ]);

    if (!initSuccess) return false;

    console.log(
      "Processing image upload...",
      targetFolder ? `to folder: ${targetFolder}` : "to root directory"
    );

    // Check configuration
    if (!config.cloudflareId || !config.workerUrl) {
      console.error(
        "Configuration error: Missing required Cloudflare ID or Worker URL"
      );
      uploadTaskManager.updateTaskState(
        uploadId,
        UploadState.ERROR,
        "Configuration missing"
      );
      showNotification(
        TOAST_STATUS.FAILED,
        "Please complete extension configuration",
        "error"
      );
      chrome.runtime.openOptionsPage();
      return false;
    }

    // Ensure Worker URL is properly formatted
    const formattedWorkerUrl = formatWorkerUrl(config.workerUrl);

    // Update status to fetching
    console.log(`Getting image data for task ${uploadId}...`);
    uploadTaskManager.updateTaskState(uploadId, UploadState.FETCHING, "");

    // Update notification
    showProcessingNotification(info, "Fetching image data...");

    // If no src URL, try to get from data transfer
    if (!info.srcUrl) {
      console.error("No source URL available for image");
      uploadTaskManager.updateTaskState(
        uploadId,
        UploadState.ERROR,
        "No image URL"
      );
      await showPageToast(
        TOAST_STATUS.FAILED,
        "No image URL found",
        "error",
        undefined,
        notificationId
      );
      return false;
    }

    // Process image URL
    try {
      const imageUrl = info.srcUrl;
      console.log(`Processing image from: ${imageUrl.substring(0, 50)}...`);

      // Get image data
      const imageResult = await fetchImageData(imageUrl, uploadId);
      if (!imageResult.success || !imageResult.imageBlob) {
        const errorMessage = imageResult.error || "Failed to fetch image";
        console.error(`Failed to get image data: ${errorMessage}`);
        uploadTaskManager.updateTaskState(
          uploadId,
          UploadState.ERROR,
          errorMessage
        );
        await showPageToast(
          TOAST_STATUS.FAILED,
          `Failed to get image: ${errorMessage}`,
          "error",
          undefined,
          notificationId
        );
        return false;
      }

      console.log(
        `Successfully fetched image: ${imageResult.imageBlob.size} bytes, type: ${imageResult.imageBlob.type}`
      );

      // Upload image
      showProcessingNotification(info, "Uploading to storage...");
      uploadTaskManager.updateTaskState(uploadId, UploadState.UPLOADING, "");

      // Create FormData with file
      const formData = new FormData();
      const fileExt =
        imageResult.imageBlob.type.split("/")[1] ||
        imageUrl.split(".").pop() ||
        "jpg";
      const fileName = `image_${Date.now()}.${fileExt}`;

      formData.append(
        "file",
        new File([imageResult.imageBlob], fileName, {
          type: imageResult.imageBlob.type,
        })
      );
      formData.append("cloudflareId", config.cloudflareId);

      // Add important request headers to improve priority
      formData.append("priority", "high");
      formData.append("timestamp", Date.now().toString());

      // Add target folder if present
      if (targetFolder) {
        formData.append("folderName", targetFolder);
      }

      // Upload to Worker
      console.log(`Uploading to: ${formattedWorkerUrl}`);

      // Use upload function with retry capability
      const uploadResult = await uploadImageWithRetry(
        formData,
        formattedWorkerUrl,
        uploadId
      );

      // Process upload result
      if (uploadResult.success && uploadResult.result.success) {
        // Handle success
        await handleSuccessfulUpload(
          uploadResult.result,
          uploadId,
          notificationId
        );
        return true;
      } else {
        // Handle failure
        await handleFailedUpload(
          uploadResult.error || uploadResult.result?.error,
          uploadId,
          notificationId
        );
        return false;
      }
    } catch (uploadError) {
      console.error(`Upload failed for task ${uploadId}:`, uploadError);
      // Error already handled in handleImageUpload, only log here without showing duplicate notification
      console.log(
        "Error already handled in handleImageUpload, not showing duplicate notification"
      );
      throw uploadError;
    }
  } catch (error) {
    console.error(`Error in handleImageUpload for task ${uploadId}:`, error);
    const errorMessage = handleError(error, "handleImageUpload");

    // Update task state to error
    uploadTaskManager.updateTaskState(
      uploadId,
      UploadState.ERROR,
      errorMessage
    );

    // Show error notifications
    showNotification(TOAST_STATUS.FAILED, errorMessage, "error");

    return false;
  }
}

// Check if source URL is valid
function validateSourceUrl(
  info: chrome.contextMenus.OnClickData,
  taskId: string
): boolean {
  if (!info.srcUrl) {
    uploadTaskManager.updateTaskState(
      taskId,
      UploadState.ERROR,
      "Unable to get image URL"
    );
    console.error("Unable to get image URL");
    showNotification(TOAST_STATUS.FAILED, "Unable to get image URL", "error");
    return false;
  }
  return true;
}

// Determine target folder based on menu item ID
async function determineTargetFolder(
  info: chrome.contextMenus.OnClickData,
  taskId: string
): Promise<{ isValid: boolean; targetFolder: string | null }> {
  // Determine target folder
  let targetFolder: string | null = null;

  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(FOLDER_PREFIX)
  ) {
    // Extract index from ID
    const folderIndex = parseInt(
      info.menuItemId.substring(FOLDER_PREFIX.length)
    );
    const config = await getConfig();
    const folders = parseFolderPath(config.folderPath);

    if (folders && folderIndex < folders.length) {
      targetFolder = folders[folderIndex];
      console.log(`Selected folder: ${targetFolder}`);
      uploadTaskManager.setTaskFolder(taskId, targetFolder);
      return { isValid: true, targetFolder };
    } else {
      uploadTaskManager.updateTaskState(
        taskId,
        UploadState.ERROR,
        "Invalid folder index"
      );
      console.error("Invalid folder index");
      showNotification(TOAST_STATUS.FAILED, "Invalid target folder", "error");
      return { isValid: false, targetFolder: null };
    }
  } else if (info.menuItemId === ROOT_FOLDER_ID) {
    // Upload to root directory
    console.log("Uploading to root directory");
    uploadTaskManager.setTaskFolder(taskId, null);
    return { isValid: true, targetFolder: null };
  } else if (info.menuItemId === PARENT_MENU_ID) {
    // This is the parent menu, which shouldn't be clickable
    uploadTaskManager.updateTaskState(
      taskId,
      UploadState.ERROR,
      "Parent menu clicked, no action needed"
    );
    console.log("Parent menu clicked, no action taken");
    return { isValid: false, targetFolder: null };
  } else {
    uploadTaskManager.updateTaskState(
      taskId,
      UploadState.ERROR,
      "Unknown menu ID"
    );
    console.error("Unknown menu item ID:", info.menuItemId);
    showNotification(TOAST_STATUS.FAILED, "Invalid menu selection", "error");
    return { isValid: false, targetFolder: null };
  }
}

// Log menu click details
function logMenuClickDetails(
  info: chrome.contextMenus.OnClickData,
  taskId: string,
  retryCount: number,
  tab?: chrome.tabs.Tab
): void {
  console.log(`Processing menu click (retry=${retryCount}):`, {
    menuItemId: info.menuItemId,
    srcUrl: info.srcUrl ? info.srcUrl.substring(0, 100) + "..." : null,
    tabId: tab?.id,
    timestamp: new Date().toISOString(),
    retryCount: retryCount,
    taskId: taskId,
  });
}

// Handle menu click error with retry support
function handleMenuClickError(
  error: unknown,
  info: chrome.contextMenus.OnClickData,
  taskId: string,
  retryCount: number,
  tab?: chrome.tabs.Tab
): void {
  // Use enhanced error handler with retry logic
  const errorMessage = handleError(error, "processMenuClick", {
    retryable: retryCount < uploadTaskManager.MAX_RETRY_COUNT,
    retryContext: {
      retryCount,
      maxRetries: uploadTaskManager.MAX_RETRY_COUNT,
      retryInterval: uploadTaskManager.RETRY_INTERVAL,
      retryCallback: () => processMenuClick(info, tab, retryCount + 1),
    },
  });

  // Update task state
  uploadTaskManager.updateTaskState(taskId, UploadState.ERROR, errorMessage);

  // Show notifications if we've reached max retries or on the first attempt
  if (retryCount === 0 || retryCount >= uploadTaskManager.MAX_RETRY_COUNT) {
    showNotification(TOAST_STATUS.FAILED, errorMessage, "error");
    // Ensure await to prevent state loss
    setTimeout(async () => {
      try {
        await showPageToast(
          TOAST_STATUS.FAILED,
          errorMessage,
          "error",
          undefined,
          taskId
        );
        console.log(`Error toast displayed for task ${taskId}`);
      } catch (toastError) {
        console.error(
          `Failed to show error toast for task ${taskId}:`,
          toastError
        );
      }
    }, 0);
  }
}

// Handle menu click event with retries
export async function processMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
  retryCount = 0
) {
  console.log(`processMenuClick START (retry=${retryCount})`);

  // Create a task for this menu click
  const taskId = uploadTaskManager.createTask(info, tab);
  console.log(`Created task ${taskId} for menu click processing`);

  // Initial toast is already shown in handleMenuClick, no need to show again
  // This prevents duplicate toasts and reduces delay

  try {
    // Log menu click details
    logMenuClickDetails(info, taskId, retryCount, tab);

    // Validate source URL - fast check, no async operation
    console.log(`Validating source URL for task ${taskId}`);
    if (!validateSourceUrl(info, taskId)) {
      console.log(`Source URL validation failed for task ${taskId}`);

      // Update failure status
      await showPageToast(
        TOAST_STATUS.FAILED,
        "Invalid image URL",
        "error",
        undefined,
        taskId
      );
      return;
    }

    // Check configuration early before proceeding with folder determination
    console.log("Getting configuration...");
    const config = await getConfig();

    // Check if configuration is complete
    if (!config.cloudflareId || !config.workerUrl) {
      console.error(
        "Configuration error: Missing required Cloudflare ID or Worker URL"
      );
      uploadTaskManager.updateTaskState(
        taskId,
        UploadState.ERROR,
        "Missing configuration"
      );
      showNotification(
        TOAST_STATUS.FAILED,
        "Please complete extension configuration",
        "error"
      );

      // Update toast to show configuration error
      await showPageToast(
        TOAST_STATUS.FAILED,
        "Please complete extension configuration",
        "error",
        undefined,
        taskId
      );

      // Open options page for user to complete configuration
      chrome.runtime.openOptionsPage();
      return;
    }

    // Determine target folder with the already obtained configuration
    console.log(`Determining target folder for task ${taskId}`);
    const folderResult = await determineTargetFolderWithConfig(
      info,
      taskId,
      config
    );
    if (!folderResult.isValid) {
      console.log(`Target folder determination failed for task ${taskId}`);

      // Update failure status
      await showPageToast(
        TOAST_STATUS.FAILED,
        "Invalid target folder",
        "error",
        undefined,
        taskId
      );
      return;
    }

    // Update toast with folder information
    await showPageToast(
      TOAST_STATUS.DROPPING,
      `Uploading to ${folderResult.targetFolder || "root"}...`,
      "loading",
      undefined,
      taskId
    );

    // Process the upload with the determined folder
    console.log(
      `Starting image upload for task ${taskId} to folder: ${
        folderResult.targetFolder || "root"
      }`
    );

    try {
      const uploadResult = await handleImageUpload(
        info,
        folderResult.targetFolder
      );
      console.log(`Image upload handling completed for task ${taskId}`);

      // handleImageUpload has already updated the status and displayed notifications, no need to display again
      // Only record status, do not display notification
      if (!uploadResult) {
        console.log(
          `Upload failed for task ${taskId} (no success notification needed)`
        );
      } else {
        console.log(
          `Upload succeeded for task ${taskId} (no success notification needed)`
        );
      }
    } catch (uploadError) {
      console.error(`Upload failed for task ${taskId}:`, uploadError);
      // Error already handled in handleImageUpload, only log here without showing duplicate notification
      console.log(
        "Error already handled in handleImageUpload, not showing duplicate notification"
      );
      throw uploadError;
    }
  } catch (error) {
    console.error(`Error in processMenuClick for task ${taskId}:`, error);
    handleMenuClickError(error, info, taskId, retryCount, tab);
  } finally {
    console.log(`processMenuClick END (retry=${retryCount})`);
  }
}

// Determine target folder based on menu item ID with passed config
async function determineTargetFolderWithConfig(
  info: chrome.contextMenus.OnClickData,
  taskId: string,
  config: any
): Promise<{ isValid: boolean; targetFolder: string | null }> {
  // Determine target folder
  let targetFolder: string | null = null;

  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(FOLDER_PREFIX)
  ) {
    // Extract index from ID
    const folderIndex = parseInt(
      info.menuItemId.substring(FOLDER_PREFIX.length)
    );
    const folders = parseFolderPath(config.folderPath);

    if (folders && folderIndex < folders.length) {
      targetFolder = folders[folderIndex];
      console.log(`Selected folder: ${targetFolder}`);
      uploadTaskManager.setTaskFolder(taskId, targetFolder);
      return { isValid: true, targetFolder };
    } else {
      uploadTaskManager.updateTaskState(
        taskId,
        UploadState.ERROR,
        "Invalid folder index"
      );
      console.error("Invalid folder index");
      showNotification(TOAST_STATUS.FAILED, "Invalid target folder", "error");
      return { isValid: false, targetFolder: null };
    }
  } else if (info.menuItemId === ROOT_FOLDER_ID) {
    // Upload to root directory
    console.log("Uploading to root directory");
    uploadTaskManager.setTaskFolder(taskId, null);
    return { isValid: true, targetFolder: null };
  } else if (info.menuItemId === PARENT_MENU_ID) {
    // This is the parent menu, which shouldn't be clickable
    uploadTaskManager.updateTaskState(
      taskId,
      UploadState.ERROR,
      "Parent menu clicked, no action needed"
    );
    console.log("Parent menu clicked, no action taken");
    return { isValid: false, targetFolder: null };
  } else {
    uploadTaskManager.updateTaskState(
      taskId,
      UploadState.ERROR,
      "Unknown menu ID"
    );
    console.error("Unknown menu item ID:", info.menuItemId);
    showNotification(TOAST_STATUS.FAILED, "Invalid menu selection", "error");
    return { isValid: false, targetFolder: null };
  }
}

/**
 * Generate unique ID
 */
function generateUniqueId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
