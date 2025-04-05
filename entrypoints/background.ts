import { defineBackground } from "wxt/utils/define-background";
import { AppConfig, getConfig } from "../utils/storage";
import { uploadImageFromUrl } from "../utils/cloudflare";

// Constants
const PARENT_MENU_ID = "d2r2-parent";
const ROOT_FOLDER_ID = "bucket-root";
const FOLDER_PREFIX = "folder-";

const TOAST_STATUS = {
  DROPPING: "Dropping",
  DONE: "Done",
  FAILED: "Failed",
};

// Extension initialization status
let extensionInitialized = false;
let initializationAttempts = 0;
const MAX_INITIALIZATION_ATTEMPTS = 10;
const INITIALIZATION_CHECK_INTERVAL = 300; // 300ms

// Add initialization mutex
let isInitializing = false;
let lastInitTime = 0;
const MIN_INIT_INTERVAL = 500; // Minimum initialization interval (ms)

// Add page state tracking
let activeTabId: number | null = null;
let lastMenuClickTime = 0;
const MENU_CLICK_COOLDOWN = 300; // Reduced cooldown to 300ms
let lastActiveUrl: string | null = null;
let pendingMenuClicks: Array<{
  info: chrome.contextMenus.OnClickData;
  tab?: chrome.tabs.Tab;
  timestamp: number;
}> = [];
const MAX_RETRY_COUNT = 3;
const RETRY_INTERVAL = 500; // ms

// Add more detailed logging
console.log = (function (originalLog) {
  return function (...args) {
    const timestamp = new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);
    originalLog.apply(console, [`[${timestamp}]`, ...args]);
  };
})(console.log);

console.error = (function (originalError) {
  return function (...args) {
    const timestamp = new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);
    originalError.apply(console, [`[${timestamp}][ERROR]`, ...args]);
  };
})(console.error);

// Helper function: Ensure Worker URL is properly formatted
function formatWorkerUrl(url: string): string {
  if (!url) return url;
  const trimmedUrl = url.trim();
  return !trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")
    ? `https://${trimmedUrl}`
    : trimmedUrl;
}

// Helper function: Handle errors consistently
function handleError(error: unknown, context: string): string {
  console.error(`Error in ${context}:`, error);
  return error instanceof Error ? error.message : String(error);
}

export default defineBackground(() => {
  console.log("D2R2 extension initializing...");

  // Process any pending menu clicks
  setInterval(() => {
    if (pendingMenuClicks.length > 0 && extensionInitialized) {
      console.log(
        `Processing ${pendingMenuClicks.length} pending menu clicks...`
      );
      const pendingClick = pendingMenuClicks.shift();
      if (pendingClick) {
        const elapsedTime = Date.now() - pendingClick.timestamp;
        console.log(`Processing click from ${elapsedTime}ms ago`);

        // Show toast for pending click being processed
        showPageToast(
          TOAST_STATUS.DROPPING,
          "Dropping",
          "loading",
          undefined,
          `upload_queue_${Date.now()}`
        );

        processMenuClick(pendingClick.info, pendingClick.tab);
      }
    }
  }, 1000);

  // Add tab update listener
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
      console.log(`Tab ${tabId} updated:`, {
        url: tab.url,
        lastUrl: lastActiveUrl,
        isActiveTab: tabId === activeTabId,
      });

      // Always reinitialize when a tab completes loading
      console.log("Tab changed, reinitializing extension...");
      activeTabId = tabId;
      lastActiveUrl = tab.url;
      await reinitializeForTab(tabId);
    }
  });

  // Add tab activation listener
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    console.log("Tab activated:", activeInfo);
    // Always reinitialize when tab changes
    activeTabId = activeInfo.tabId;
    await reinitializeForTab(activeInfo.tabId);
  });

  // Add window focus change listener
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    // WINDOW_ID_NONE (-1) means focus left Chrome
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      console.log("Browser window regained focus, windowId:", windowId);

      // Get active tab in focused window
      try {
        const tabs = await chrome.tabs.query({ active: true, windowId });
        if (tabs && tabs.length > 0 && tabs[0].id) {
          console.log(
            "Reinitializing for focused window active tab:",
            tabs[0].id
          );
          activeTabId = tabs[0].id;
          await reinitializeForTab(tabs[0].id);

          // Special handling to ensure menu is working
          extensionInitialized = false;
          await quickInitialize();
        }
      } catch (error) {
        console.error("Error handling window focus:", error);
      }
    }
  });

  // Create test message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Received message:", message);

    if (message.action === "testUpload") {
      const { workerUrl } = message.data || {};
      console.log("Testing Worker connection:", { workerUrl });

      if (!workerUrl) {
        sendResponse({ success: false, error: "Missing Worker URL" });
        return true;
      }

      // Format Worker URL
      const formattedWorkerUrl = formatWorkerUrl(workerUrl);

      // Show test start notification
      try {
        showNotification(TOAST_STATUS.DROPPING, "Testing Worker connection...");
      } catch (e) {
        console.error("Failed to show notification:", e);
      }

      // Test connection with GET request
      fetch(formattedWorkerUrl, {
        method: "GET",
        headers: {
          Origin: chrome.runtime.getURL(""),
        },
      })
        .then((response) => {
          console.log(
            "Connection test response:",
            response.status,
            response.statusText
          );
          return response.text();
        })
        .then((text) => {
          if (!text || text.trim() === "") {
            showNotification(
              TOAST_STATUS.FAILED,
              "Worker returned an empty response, please check configuration"
            );
            sendResponse({
              success: false,
              error: "Worker returned an empty response",
            });
            return;
          }

          try {
            const data = JSON.parse(text);
            if (data && data.success) {
              showNotification(
                TOAST_STATUS.DONE,
                `Worker connection normal: ${
                  data.message || "Connection successful"
                }`
              );
              sendResponse({ success: true, data });
            } else {
              const errorMsg =
                data.error || "Worker returned an abnormal response";
              showNotification(TOAST_STATUS.FAILED, errorMsg);
              sendResponse({ success: false, error: errorMsg });
            }
          } catch (e) {
            showNotification(
              TOAST_STATUS.DONE,
              "Worker response is not JSON format, but connection succeeded"
            );
            sendResponse({
              success: true,
              data: {
                message:
                  "Connection successful, but response is not JSON format",
              },
              rawResponse: text,
            });
          }
        })
        .catch((error) => {
          const errorMessage = handleError(error, "Connection test");
          showNotification(TOAST_STATUS.FAILED, errorMessage);
          sendResponse({ success: false, error: errorMessage });
        });

      return true;
    }
  });

  // Initialize extension
  async function initializeExtension() {
    try {
      console.log("Starting extension initialization...");

      // Get current active tab
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs && tabs[0]?.id) {
        activeTabId = tabs[0].id;
        console.log(`Initializing for active tab ${activeTabId}`);
      }

      // Verify icon resources are available
      try {
        const iconUrl = chrome.runtime.getURL("icon/48.png");
        console.log("Verifying icon URL:", iconUrl);
        const iconResponse = await fetch(iconUrl);
        if (iconResponse.ok) {
          console.log("Icon resource verification successful");
        } else {
          console.error(
            "Icon resource inaccessible:",
            iconResponse.status,
            iconResponse.statusText
          );
        }
      } catch (iconError) {
        console.error("Icon resource verification failed:", iconError);
      }

      // Create context menu
      await updateContextMenu();

      // Listen for configuration changes, update menu
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "sync" && changes["d2r2_config"]) {
          console.log("Configuration updated, recreating menu");
          updateContextMenu();
        }
      });

      // Test notification functionality
      console.log("Testing notification functionality...");
      chrome.permissions.contains(
        { permissions: ["notifications"] },
        function (result) {
          if (result) {
            console.log(
              "Notification permission granted, attempting to show welcome notification"
            );

            // Silent initialization, no notification
            console.log("Extension initialized silently");

            // Silent initialization, no test prompt
            console.log("Content script ready, no notification sent");

            // Test page toast notification
            setTimeout(async () => {
              try {
                console.log("Testing page toast notification...");
                // Get current active tab
                const tabs = await chrome.tabs.query({
                  active: true,
                  currentWindow: true,
                });
                if (tabs && tabs.length > 0 && tabs[0].id) {
                  // Check if current tab can be injected
                  const tabId = tabs[0].id as number;
                  console.log(`Attempting to send test toast to tab ${tabId}`);

                  // First check if content script is ready
                  try {
                    chrome.tabs.sendMessage(
                      tabId,
                      { action: "ping" },
                      (response) => {
                        const hasError = chrome.runtime.lastError;
                        if (hasError) {
                          console.log(
                            "Content script not responding, may be new page or not loaded: ",
                            hasError
                          );
                          // Don't proceed with test, this is normal for new tabs
                        } else {
                          // Content script is ready, send test notification
                          console.log(
                            "Content script ready, no notification sent"
                          );
                        }
                      }
                    );
                  } catch (pingError) {
                    console.error("Error checking content script: ", pingError);
                  }
                } else {
                  console.log("No available tabs for toast test");
                }
              } catch (toastTestError) {
                console.error("Error testing page toast:", toastTestError);
              }
            }, 2000);
          } else {
            console.warn(
              "Warning: No notification permission, may not be able to show upload status"
            );
          }
        }
      );

      console.log("D2R2 extension initialization completed ✅");

      // Set initialization completed flag
      extensionInitialized = true;
    } catch (error) {
      console.error("Extension initialization failed:", error);
    }
  }

  // Handle context menu click
  async function handleImageClick(
    info: chrome.contextMenus.OnClickData,
    targetFolder?: string | null
  ) {
    console.log("Starting image upload...");

    if (!info.srcUrl) {
      console.error("Error: Unable to get image URL");
      showNotification(TOAST_STATUS.FAILED, "Unable to get image URL");
      return;
    }

    try {
      // Log request details (useful for debugging and error reporting)
      console.log(
        JSON.stringify({
          operation: "imageUpload",
          imageUrl: info.srcUrl.substring(0, 100) + "...",
          targetFolder: targetFolder || "(Upload to root directory)",
        })
      );

      // Get configuration
      console.log("Getting configuration...");
      const config = await getConfig();

      // Check configuration
      if (!config.cloudflareId || !config.workerUrl) {
        console.error(
          "Configuration error: Missing required Cloudflare ID or Worker URL"
        );
        showNotification(
          TOAST_STATUS.FAILED,
          "Please complete extension configuration"
        );
        chrome.runtime.openOptionsPage();
        return;
      }

      // Use the provided targetFolder or default value
      const folderPath = targetFolder || null;

      // Generate a unique ID for the upload task
      const uploadId = `upload_${Date.now()}`;

      // Show upload start toast (loading state)
      await showPageToast(
        TOAST_STATUS.DROPPING,
        "Dropping",
        "loading",
        undefined,
        uploadId
      );

      // Directly get image data rather than URL
      console.log("Starting to directly get image data from browser...");

      // 1. Use fetch to get image
      try {
        const imageResponse = await fetch(info.srcUrl);
        if (!imageResponse.ok) {
          throw new Error(
            `Failed to get image: ${imageResponse.status} ${imageResponse.statusText}`
          );
        }

        // 2. Get image's Blob data
        const imageBlob = await imageResponse.blob();
        console.log(
          "Successfully got image data:",
          `Type=${imageBlob.type}, Size=${imageBlob.size} bytes`
        );

        // Check if it's really an image type
        if (!imageBlob.type.startsWith("image/")) {
          console.warn(`Got data is not image type: ${imageBlob.type}`);
        }

        // Update toast to show still processing
        await showPageToast(
          TOAST_STATUS.DROPPING,
          "Dropping",
          "loading",
          undefined,
          uploadId
        );

        // 3. Generate file name (based on original URL and timestamp)
        const urlObj = new URL(info.srcUrl);
        const originalFilename = urlObj.pathname.split("/").pop() || "";
        const fileExtension =
          (originalFilename.includes(".")
            ? originalFilename.split(".").pop()
            : imageBlob.type.split("/").pop()) || "jpg";

        const timestamp = Date.now();
        const filename = `image_${timestamp}.${fileExtension}`;

        // 4. Create FormData and add file
        const formData = new FormData();
        formData.append(
          "file",
          new File([imageBlob], filename, { type: imageBlob.type })
        );
        formData.append("cloudflareId", config.cloudflareId);

        // Add folder information (if any)
        if (folderPath) {
          formData.append("folderName", folderPath);
        }

        // Ensure Worker URL is properly formatted
        const formattedWorkerUrl = formatWorkerUrl(config.workerUrl);

        // 5. Send FormData to Worker
        console.log(`Sending image data to Worker: ${formattedWorkerUrl}`);

        // Update toast to show sending
        await showPageToast(
          TOAST_STATUS.DROPPING,
          "Dropping",
          "loading",
          undefined,
          uploadId
        );

        const response = await fetch(formattedWorkerUrl, {
          method: "POST",
          body: formData,
        });

        // 6. Handle response
        let result: { success: boolean; url?: string; error?: string } = {
          success: false,
        };

        try {
          const respText = await response.text();
          console.log("Worker response:", respText);

          // Update toast to show processing response
          await showPageToast(
            TOAST_STATUS.DROPPING,
            "Dropping",
            "loading",
            undefined,
            uploadId
          );

          try {
            result = JSON.parse(respText);
          } catch (parseError) {
            console.error("Failed to parse response:", parseError);

            // Try extracting URL from text
            if (
              respText.includes('"success":true') &&
              respText.includes('"url"')
            ) {
              const urlMatch = respText.match(/"url"\s*:\s*"([^"]+)"/);
              if (urlMatch && urlMatch[1]) {
                result = {
                  success: true,
                  url: urlMatch[1],
                };
              } else {
                throw new Error("Unable to parse response");
              }
            } else {
              throw new Error("Response format error");
            }
          }
        } catch (error) {
          console.error("Error handling response:", error);
          result = {
            success: false,
            error: `Error handling response: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }

        // Handle upload result
        if (result.success) {
          console.log(
            `Upload successful! URL: ${
              result.url
                ? result.url.substring(0, 60) + "..."
                : "No URL returned"
            }`
          );

          // Try copying URL to clipboard
          let successMessage = "Image uploaded successfully";

          if (result.url) {
            try {
              // Check if clipboard API is available
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(result.url);
                console.log("Image URL copied to clipboard");
                successMessage =
                  "Image uploaded successfully, URL copied to clipboard";
              }
            } catch (clipError) {
              console.error("Unable to copy URL to clipboard:", clipError);
            }
          }

          // Update toast to success state
          await showPageToast(
            TOAST_STATUS.DONE,
            successMessage,
            "success",
            undefined,
            uploadId
          );
        } else {
          // Handle error case
          let errorMessage = "Upload failed";

          if (result.error) {
            console.error(
              "Upload failure details:",
              typeof result.error,
              result.error
            );

            // Handle common error types
            const errorStr =
              typeof result.error === "object"
                ? JSON.stringify(result.error)
                : String(result.error);

            if (
              errorStr.includes("Failed to fetch") ||
              errorStr.includes("Unable to get image")
            ) {
              errorMessage =
                "Upload failed: Website may restrict external access to images";
              console.error(
                "Upload failed: Website may restrict external access to images"
              );
            } else if (
              errorStr.includes("Unauthorized") ||
              errorStr.includes("403")
            ) {
              errorMessage =
                "Upload failed: Access denied, please check if Cloudflare ID is correct";
              console.error(
                "Upload failed: Access denied, please check if Cloudflare ID is correct"
              );
            } else {
              errorMessage = `Upload failed: ${errorStr}`;
              console.error(`Upload failed: ${errorStr}`);
            }
          } else {
            errorMessage = "Unknown error occurred during upload";
            console.error("Upload failed: Unknown error");
          }

          // Update toast to error state
          await showPageToast(
            TOAST_STATUS.FAILED,
            errorMessage,
            "error",
            undefined,
            uploadId
          );
        }
      } catch (fetchError) {
        console.error("Failed to get image data:", fetchError);

        // Update toast to error state
        const errorMessage = `Failed to get image: ${
          fetchError instanceof Error ? fetchError.message : String(fetchError)
        }`;
        await showPageToast(
          TOAST_STATUS.FAILED,
          errorMessage,
          "error",
          undefined,
          uploadId
        );
      }
    } catch (error) {
      console.error("Error handling upload:", error);

      // Generate a new uploadId, because this is an unexpected error that could occur before uploadId is created
      const errorUploadId = `upload_error_${Date.now()}`;

      // Update toast to error state
      const errorMessage = `Error occurred during upload: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      await showPageToast(
        TOAST_STATUS.FAILED,
        errorMessage,
        "error",
        undefined,
        errorUploadId
      );
    }
  }

  // Helper to show toast notification in web page
  async function showPageToast(
    title: string,
    message: string,
    type: "success" | "error" | "info" | "loading" = "info",
    imageUrl?: string,
    toastId?: string
  ) {
    try {
      // Get current active tab
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tabs || !tabs[0]?.id) {
        console.error("Unable to get current active tab");
        return;
      }

      const activeTab = tabs[0];
      console.log(
        `[Toast][${toastId || "unknown"}] ${title}: ${message.substring(
          0,
          50
        )}${message.length > 50 ? "..." : ""}`
      );

      // Check tab URL to ensure not on chrome:// etc.
      if (
        activeTab.url &&
        (activeTab.url.startsWith("chrome://") ||
          activeTab.url.startsWith("chrome-extension://") ||
          activeTab.url.startsWith("about:"))
      ) {
        console.log(`Cannot show toast on special page: ${activeTab.url}`);
        return;
      }

      // Send message to content script
      const tabId = activeTab.id as number;
      chrome.tabs.sendMessage(
        tabId,
        {
          action: "showToast",
          data: { title, message, type, imageUrl, toastId },
        },
        (response) => {
          // Check for errors but don't block execution
          const hasError = chrome.runtime.lastError;
          if (hasError) {
            console.log(
              "Toast message may have failed (this is normal if page doesn't allow injection):",
              hasError
            );
            return;
          }

          if (response && response.success) {
            console.log("Toast displayed on page");
          } else if (response) {
            console.error(
              "Toast display failed:",
              response.error || "Unknown reason"
            );
          } else {
            console.log(
              "No toast response received (content script may not be loaded)"
            );
          }
        }
      );
    } catch (error) {
      console.error("Error showing page toast:", error);
    }
  }

  // Helper to show notifications
  function showNotification(title: string, message: string, imageUrl?: string) {
    try {
      // Also try to show toast on page
      const toastType =
        title === TOAST_STATUS.DONE
          ? "success"
          : title === TOAST_STATUS.FAILED
          ? "error"
          : "loading";
      const notificationId = `d2r2_${Date.now()}`;
      showPageToast(title, message, toastType, imageUrl, notificationId);

      console.log(
        `[Notification] ${title}: ${message.substring(0, 50)}${
          message.length > 50 ? "..." : ""
        }${imageUrl ? ` (URL: ${imageUrl})` : ""}`
      );

      // Ensure notification permission
      chrome.permissions.contains(
        { permissions: ["notifications"] },
        (hasPermission) => {
          console.log(
            "Notification permission check:",
            hasPermission ? "Granted" : "Not granted"
          );

          if (!hasPermission) {
            console.error(
              "No notification permission, cannot show notification"
            );
            return;
          }

          // Remove sameID click listener
          const handleNotificationClick = (clickedId: string) => {
            console.log(
              `Notification click event triggered, clicked ID: ${clickedId}, expected ID: ${notificationId}`
            );
            if (clickedId === notificationId && imageUrl) {
              console.log(`Notification clicked, opening URL: ${imageUrl}`);
              chrome.tabs.create({ url: imageUrl });
              // Remove notification
              chrome.notifications.clear(clickedId);
              // Remove listener
              chrome.notifications.onClicked.removeListener(
                handleNotificationClick
              );
            }
          };

          // Add click listener (if URL exists)
          if (imageUrl) {
            chrome.notifications.onClicked.addListener(handleNotificationClick);
            console.log("Notification click listener added");
          }

          // Get icon's absolute URL
          const iconUrl = chrome.runtime.getURL("icon/48.png");
          console.log("Notification icon URL:", iconUrl);

          chrome.notifications.create(
            notificationId,
            {
              type: "basic",
              iconUrl: iconUrl,
              title,
              message,
              isClickable: !!imageUrl,
              priority: 2, // High priority
            },
            (createdId) => {
              if (chrome.runtime.lastError) {
                console.error(
                  "Notification creation failed:",
                  chrome.runtime.lastError
                );
                // If creation fails, remove listener
                if (imageUrl) {
                  chrome.notifications.onClicked.removeListener(
                    handleNotificationClick
                  );
                }
              } else {
                console.log(
                  `Notification created successfully, ID: ${createdId}`
                );
              }
            }
          );
        }
      );
    } catch (error) {
      console.error("Error showing notification:", error);
    }
  }

  // Handle menu click event with retries
  async function processMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab,
    retryCount = 0
  ) {
    try {
      console.log(`Processing menu click (retry=${retryCount}):`, {
        menuItemId: info.menuItemId,
        srcUrl: info.srcUrl ? info.srcUrl.substring(0, 100) + "..." : null,
        tabId: tab?.id,
        timestamp: new Date().toISOString(),
        retryCount: retryCount,
      });

      if (!info.srcUrl) {
        console.error("Unable to get image URL");
        showNotification(TOAST_STATUS.FAILED, "Unable to get image URL");
        return;
      }

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
          await handleImageUpload(info, targetFolder);
        } else {
          console.error("Invalid folder index");
          showNotification(TOAST_STATUS.FAILED, "Invalid target folder");
        }
      } else if (info.menuItemId === ROOT_FOLDER_ID) {
        // Upload to root directory
        console.log("Uploading to root directory");
        await handleImageUpload(info, null);
      } else if (info.menuItemId === PARENT_MENU_ID) {
        // This is the parent menu, which shouldn't be clickable
        console.log("Parent menu clicked, no action taken");
      } else {
        console.error("Unknown menu item ID:", info.menuItemId);
        showNotification(TOAST_STATUS.FAILED, "Invalid menu selection");
      }
    } catch (error) {
      console.error(`Error in processMenuClick (retry=${retryCount}):`, error);

      // Implement retry logic
      if (retryCount < MAX_RETRY_COUNT) {
        console.log(
          `Retrying menu click in ${RETRY_INTERVAL}ms (attempt ${
            retryCount + 1
          }/${MAX_RETRY_COUNT})...`
        );
        setTimeout(() => {
          processMenuClick(info, tab, retryCount + 1);
        }, RETRY_INTERVAL);
      } else {
        console.error("Max retry attempts reached, giving up");
        showNotification(
          TOAST_STATUS.FAILED,
          error instanceof Error
            ? error.message
            : "Unknown error in menu click handler",
          undefined
        );
      }
    }
  }

  // Helper function: Show notification if image is being processed
  function showProcessingNotification(info: chrome.contextMenus.OnClickData) {
    const srcUrl = info.srcUrl
      ? info.srcUrl.substring(0, 30) + "..."
      : "unknown";
    showNotification(TOAST_STATUS.DROPPING, "Dropping", undefined);
    console.log(
      "Added to queue, will be processed when extension is fully initialized"
    );
  }

  // Initial menu click handler - queues clicks if not ready
  async function handleMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ) {
    try {
      // Record click timing
      const now = Date.now();

      // Always immediately show a processing toast, regardless of any conditions
      const uploadId = `upload_click_${now}`;
      await showPageToast(
        TOAST_STATUS.DROPPING,
        "Dropping",
        "loading",
        undefined,
        uploadId
      );

      if (now - lastMenuClickTime < MENU_CLICK_COOLDOWN) {
        console.log("Menu click ignored - in cooldown period");
        return;
      }
      lastMenuClickTime = now;

      // Always show a processing notification immediately
      showProcessingNotification(info);

      // Update active tab and URL
      if (tab?.id) {
        activeTabId = tab.id;
        lastActiveUrl = tab.url || null;
      }

      console.log("Menu click event triggered", {
        menuItemId: info.menuItemId,
        srcUrl: info.srcUrl ? info.srcUrl.substring(0, 100) + "..." : null,
        tabId: tab?.id,
        extensionInitialized: extensionInitialized,
      });

      // Always force initialize on menu click to handle window switching case
      console.log("Force initializing on menu click...");
      extensionInitialized = false;
      const quickInitResult = await quickInitialize();
      extensionInitialized = true; // Force set to true even if quick init failed
      console.log("Force initialization completed");

      // Update toast to indicate processing
      await showPageToast(
        TOAST_STATUS.DROPPING,
        "Dropping",
        "loading",
        undefined,
        uploadId
      );

      // Process the click immediately
      await processMenuClick(info, tab);
    } catch (error) {
      console.error("Error in handleMenuClick:", error);

      // Add to pending queue as fallback
      pendingMenuClicks.push({
        info,
        tab,
        timestamp: Date.now(),
      });

      // Show dropping notification
      showProcessingNotification(info);
    }
  }

  // Quick initialization function for faster response
  async function quickInitialize(): Promise<boolean> {
    try {
      // Prevent concurrent initialization
      if (isInitializing) {
        console.log("Another initialization is in progress, waiting...");
        // Wait for previous initialization to complete
        let waitCount = 0;
        while (isInitializing && waitCount < 10) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          waitCount++;
        }

        if (isInitializing) {
          console.log(
            "Waited too long for previous initialization, forcing continuation"
          );
        } else {
          console.log("Previous initialization completed, continuing");
          return extensionInitialized;
        }
      }

      // Check initialization interval
      const now = Date.now();
      if (now - lastInitTime < MIN_INIT_INTERVAL) {
        console.log(
          `Last initialization was ${now - lastInitTime}ms ago, too recent`
        );
        return extensionInitialized;
      }

      // Set mutex lock and timestamp
      isInitializing = true;
      lastInitTime = now;

      console.log("Attempting quick initialization...");

      // Force clear and recreate menus
      try {
        await chrome.contextMenus.removeAll();
        console.log("Cleared existing menus in quick initialization");
      } catch (e) {
        console.log("Error clearing menus (non-critical):", e);
      }

      // Update context menu
      await updateContextMenu();

      // Check content script if we have an active tab
      if (activeTabId) {
        try {
          // Non-blocking ping to content script
          chrome.tabs.sendMessage(
            activeTabId,
            { action: "ping" },
            (response) => {
              if (chrome.runtime.lastError) {
                console.log(
                  "Content script not ready in active tab:",
                  chrome.runtime.lastError.message
                );
              } else {
                console.log("Content script is ready in active tab");
              }
            }
          );
        } catch (e) {
          console.log("Error checking content script (non-critical):", e);
        }
      }

      // Set flag
      extensionInitialized = true;
      console.log("Quick initialization complete");
      return true;
    } catch (error) {
      console.error("Quick initialization failed:", error);
      return false;
    } finally {
      // Release mutex lock
      isInitializing = false;
    }
  }

  // Add new function to reinitialize extension for a specific tab
  async function reinitializeForTab(tabId: number) {
    try {
      // Prevent concurrent initialization
      if (isInitializing) {
        console.log(
          `Reinitialization for tab ${tabId} skipped - another initialization in progress`
        );
        return;
      }

      // Check initialization interval
      const now = Date.now();
      if (now - lastInitTime < MIN_INIT_INTERVAL) {
        console.log(
          `Last initialization was ${
            now - lastInitTime
          }ms ago, skipping for tab ${tabId}`
        );
        return;
      }

      // Set mutex lock and timestamp
      isInitializing = true;
      lastInitTime = now;

      console.log(`Reinitializing extension for tab ${tabId}...`);

      // Reset initialization state
      extensionInitialized = false;

      // Clear existing menus to avoid conflicts
      try {
        await chrome.contextMenus.removeAll();
        console.log("Cleared existing menus in reinitialization");
      } catch (e) {
        console.log("Error clearing menus (non-critical):", e);
      }

      // Update context menu
      await updateContextMenu();

      // Verify content script is loaded with timeout
      let contentScriptReady = false;
      try {
        await new Promise<void>((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
            if (!chrome.runtime.lastError && response) {
              console.log("Content script verified for tab", tabId);
              contentScriptReady = true;
            }
            resolve();
          });

          // Add timeout to ensure promise resolves
          setTimeout(resolve, 300);
        });
      } catch (error) {
        console.log("Content script check error (non-critical):", error);
      }

      // Set initialization flag
      extensionInitialized = true;
      console.log(
        `Extension reinitialized for tab ${tabId}, content script ready: ${contentScriptReady}`
      );

      // Process any pending clicks
      if (pendingMenuClicks.length > 0) {
        console.log(
          `Processing ${pendingMenuClicks.length} pending clicks after reinitialization`
        );
      }
    } catch (error) {
      console.error("Failed to reinitialize extension:", error);
      // Still set initialization flag to true to prevent getting stuck
      extensionInitialized = true;
    } finally {
      // Release mutex lock
      isInitializing = false;
    }
  }

  // Helper function to safely create menu item
  async function safeCreateMenuItem(
    properties: chrome.contextMenus.CreateProperties
  ): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        chrome.contextMenus.create(properties, () => {
          if (chrome.runtime.lastError) {
            console.error(
              `Failed to create menu item ${properties.id}:`,
              JSON.stringify(chrome.runtime.lastError)
            );
            resolve(false);
          } else {
            resolve(true);
          }
        });
      } catch (e) {
        console.error(`Exception creating menu item ${properties.id}:`, e);
        resolve(false);
      }
    });
  }

  // Create or update right-click menu
  async function updateContextMenu(retryCount = 0) {
    try {
      console.log(`Updating context menu (retry=${retryCount})...`);

      // First clear existing menu
      await chrome.contextMenus.removeAll();
      console.log("Existing menu items cleared");

      // Add a small delay to ensure menu clearing is complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get current configuration
      const config = await getConfig();

      // Log config details (redacted for security)
      console.log("Context menu configuration:", {
        folderCount: !!config.folderPath
          ? parseFolderPath(config.folderPath).length
          : 0,
        hideRoot: config.hideRoot,
        hasCloudflareId: !!config.cloudflareId,
        hasWorkerUrl: !!config.workerUrl,
      });

      const folders = parseFolderPath(config.folderPath);

      // Add safety delay to ensure previous menu operations are completed
      if (retryCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Based on folder path count and hideRoot setting, decide menu structure
      if (!folders || folders.length === 0) {
        // Case 1: No folder path, create single menu item
        await safeCreateMenuItem({
          id: ROOT_FOLDER_ID,
          title: "Drop to R2",
          contexts: ["image"],
        });
      } else if (folders.length === 1 && config.hideRoot) {
        // Case 2: Single folder path with hideRoot enabled
        const folderName = folders[0];
        await safeCreateMenuItem({
          id: `${FOLDER_PREFIX}0`,
          title: `Drop to R2 / ${folderName}`.replace(/\s*\/\s*/g, " / "),
          contexts: ["image"],
        });
      } else {
        // Case 3: Multiple folder paths or hideRoot disabled
        // Create parent menu
        const parentCreated = await safeCreateMenuItem({
          id: PARENT_MENU_ID,
          title: "Drop to R2",
          contexts: ["image"],
        });

        if (!parentCreated) {
          console.log(
            "Failed to create parent menu, aborting submenu creation"
          );
          return false;
        }

        console.log("Parent menu created successfully");

        // Add "Upload to root directory" option if not hidden
        if (!config.hideRoot) {
          await safeCreateMenuItem({
            id: ROOT_FOLDER_ID,
            parentId: PARENT_MENU_ID,
            title: "root" + " ".repeat(16),
            contexts: ["image"],
          });
        }

        // Create submenus for each folder
        for (const [index, folder] of folders.entries()) {
          await safeCreateMenuItem({
            id: `${FOLDER_PREFIX}${index}`,
            parentId: PARENT_MENU_ID,
            title: ` / ${folder}`.replace(/\s*\/\s*/g, " / "),
            contexts: ["image"],
          });
        }
      }

      // Register click event
      if (!chrome.contextMenus.onClicked.hasListener(handleMenuClick)) {
        chrome.contextMenus.onClicked.addListener(handleMenuClick);
        console.log("Menu click listener registered");
      } else {
        console.log("Menu click listener already registered");
      }

      // Log result
      console.log("Context menu update completed successfully");
      return true;
    } catch (error) {
      console.error("Failed to create menu:", error);

      // Add retry logic with maximum retries
      if (retryCount < 3) {
        console.log(`Retrying menu creation (attempt ${retryCount + 1}/3)...`);
        // Wait a moment before retrying
        await new Promise((resolve) => setTimeout(resolve, 800));
        return updateContextMenu(retryCount + 1);
      }

      return false;
    }
  }

  // Parse folder path string
  function parseFolderPath(folderPath: string | undefined): string[] {
    if (!folderPath || folderPath.trim() === "") {
      return [];
    }

    // Support both half-width comma(,) and full-width comma(，) as separators
    return folderPath
      .replace(/，/g, ",") // First convert full-width comma to half-width comma
      .split(",")
      .map((path) => path.trim())
      .filter((path) => path !== "");
  }

  // Handle image upload
  async function handleImageUpload(
    info: chrome.contextMenus.OnClickData,
    targetFolder: string | null
  ) {
    try {
      // Check if extension is initialized completed
      if (!extensionInitialized) {
        console.log("Upload request delayed - Extension initializing");
        // Show upload status
        const uploadId = `upload_init_${Date.now()}`;
        await showPageToast(
          TOAST_STATUS.DROPPING,
          "Dropping",
          "loading",
          undefined,
          uploadId
        );

        // Wait for initialization with more attempts
        let waitCount = 0;
        while (
          !extensionInitialized &&
          waitCount < MAX_INITIALIZATION_ATTEMPTS
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, INITIALIZATION_CHECK_INTERVAL)
          );
          waitCount++;
          console.log(
            `Initialization attempt ${waitCount}/${MAX_INITIALIZATION_ATTEMPTS}`
          );

          // Update toast while waiting
          if (waitCount % 3 === 0) {
            await showPageToast(
              TOAST_STATUS.DROPPING,
              "Dropping",
              "loading",
              undefined,
              uploadId
            );
          }
        }

        // Check again
        if (!extensionInitialized) {
          await showPageToast(
            TOAST_STATUS.FAILED,
            "Extension initialization failed, please reload the extension",
            "error",
            undefined,
            uploadId
          );
          return;
        } else {
          // Initialized, update status
          await showPageToast(
            TOAST_STATUS.DROPPING,
            "Dropping",
            "loading",
            undefined,
            uploadId
          );
        }
      }

      console.log(
        "Processing image upload...",
        targetFolder ? `to folder: ${targetFolder}` : "to root directory"
      );

      // Get configuration
      const config = await getConfig();

      // Check configuration
      if (!config.cloudflareId || !config.workerUrl) {
        console.error(
          "Configuration error: Missing required Cloudflare ID or Worker URL"
        );
        showNotification(
          TOAST_STATUS.FAILED,
          "Please complete extension configuration",
          undefined
        );
        chrome.runtime.openOptionsPage();
        return;
      }

      // Ensure Worker URL is properly formatted
      const formattedWorkerUrl = formatWorkerUrl(config.workerUrl);

      // Remove uploading notification, only keep logs
      console.log("Getting image data...");

      // Handle upload logic
      await handleImageClick(info, targetFolder);
    } catch (error) {
      console.error("Error handling upload:", error);
      showNotification(
        TOAST_STATUS.FAILED,
        error instanceof Error ? error.message : "Unknown error",
        undefined
      );
    }
  }

  // Initialize when the extension loads
  initializeExtension();
  console.log("D2R2 extension background service started");
});
