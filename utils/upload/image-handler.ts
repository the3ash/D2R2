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
import { pageStateManager } from "../state";

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

    // 优化Blob获取，直接使用流处理
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

// Create upload form data
function createUploadFormData(
  imageBlob: Blob,
  imageUrl: string,
  cloudflareId: string,
  folderPath: string | null
): { formData: FormData; filename: string } {
  // Generate file name (based on original URL and timestamp)
  const urlObj = new URL(imageUrl);
  const originalFilename = urlObj.pathname.split("/").pop() || "";
  const fileExtension =
    (originalFilename.includes(".")
      ? originalFilename.split(".").pop()
      : imageBlob.type.split("/").pop()) || "jpg";

  const timestamp = Date.now();
  const filename = `image_${timestamp}.${fileExtension}`;

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

// Upload image to server
async function uploadImageToServer(
  formData: FormData,
  workerUrl: string,
  uploadId: string
): Promise<{ success: boolean; result?: any; error?: string }> {
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
      },
      // Disable fetch's default caching mechanism
      cache: "no-store",
    });

    clearTimeout(timeoutId); // Clear timeout timer

    // Update state to show processing response
    uploadTaskManager.updateTaskState(uploadId, UploadState.PROCESSING);

    const respText = await response.text();
    console.log("Worker response:", respText);

    try {
      const result = JSON.parse(respText);
      return { success: true, result };
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
          };
        }
      }

      throw new Error("Response format error");
    }
  } catch (error) {
    console.error("Error handling response:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);

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
    };
  }
}

// Add a new parallel upload function
async function uploadImageWithRetry(
  formData: FormData,
  workerUrl: string,
  uploadId: string,
  maxRetries = 2
): Promise<{ success: boolean; result?: any; error?: string }> {
  let retryCount = 0;
  let lastError: string | undefined;

  while (retryCount <= maxRetries) {
    try {
      if (retryCount > 0) {
        console.log(`Retry attempt ${retryCount} for upload ${uploadId}`);
        uploadTaskManager.updateTaskState(
          uploadId,
          UploadState.UPLOADING,
          `Retry #${retryCount}...`
        );
        // Add random delay to avoid simultaneous retries
        await new Promise((r) => setTimeout(r, Math.random() * 1000 + 500));
      }

      return await uploadImageToServer(formData, workerUrl, uploadId);
    } catch (error) {
      retryCount++;
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`Upload attempt ${retryCount} failed: ${lastError}`);

      if (retryCount > maxRetries) {
        break;
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} retries. Last error: ${lastError}`,
  };
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

    // Create form data for upload
    const { formData, filename } = createUploadFormData(
      imageDataResult.imageBlob!,
      info.srcUrl,
      config.cloudflareId,
      folderPath
    );

    // Add important request headers to improve priority
    formData.append("priority", "high");
    formData.append("timestamp", Date.now().toString());

    // Ensure Worker URL is properly formatted
    const formattedWorkerUrl = formatWorkerUrl(config.workerUrl);

    // Update toast to show sending
    await showLoadingToast(uploadId);

    // Use upload function with retry capability
    const uploadResult = await uploadImageWithRetry(
      formData,
      formattedWorkerUrl,
      uploadId
    );

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

  // Initial toast already shown in handleMenuClick, no need to show it again here
  // This avoids duplicate toast notifications

  try {
    // Log menu click details
    logMenuClickDetails(info, taskId, retryCount, tab);

    // Validate source URL
    console.log(`Validating source URL for task ${taskId}`);
    if (!validateSourceUrl(info, taskId)) {
      console.log(`Source URL validation failed for task ${taskId}`);

      // Ensure update failure status
      await showPageToast(
        TOAST_STATUS.FAILED,
        "Invalid image URL",
        "error",
        undefined,
        taskId
      );
      return;
    }

    // Determine target folder
    console.log(`Determining target folder for task ${taskId}`);
    const folderResult = await determineTargetFolder(info, taskId);
    if (!folderResult.isValid) {
      console.log(`Target folder determination failed for task ${taskId}`);

      // Ensure update failure status
      await showPageToast(
        TOAST_STATUS.FAILED,
        "Invalid target folder",
        "error",
        undefined,
        taskId
      );
      return;
    }

    // Update status prompt processing
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

/**
 * Generate unique ID
 */
function generateUniqueId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
