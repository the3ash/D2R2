import { defineBackground } from "wxt/utils/define-background";
import { AppConfig, getConfig } from "../utils/storage";
import { uploadImageFromUrl } from "../utils/cloudflare";

// Constants
const PARENT_MENU_ID = "d2r2-parent";
const ROOT_FOLDER_ID = "bucket-root";
const FOLDER_PREFIX = "folder-";

// Extension initialization status
let extensionInitialized = false;

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
        showNotification("Connection Test", "Testing Worker connection...");
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
              "Connection Test",
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
                "Connection Successful",
                `Worker connection normal: ${
                  data.message || "Connection successful"
                }`
              );
              sendResponse({ success: true, data });
            } else {
              const errorMsg =
                data.error || "Worker returned an abnormal response";
              showNotification("Connection Issue", errorMsg);
              sendResponse({ success: false, error: errorMsg });
            }
          } catch (e) {
            showNotification(
              "Connection Test",
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
          showNotification("Connection Failed", errorMessage);
          sendResponse({ success: false, error: errorMessage });
        });

      return true;
    }
  });

  // Initialize extension
  async function initializeExtension() {
    try {
      console.log("Starting extension initialization...");

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
    console.log("Processing image upload...");

    if (!info.srcUrl) {
      console.error("Error: Unable to get image URL");
      showNotification("Upload Failed", "Unable to get image URL");
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
          "Configuration Error",
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
      const uploadStartMsg = `Uploading image${
        folderPath ? ` to ${folderPath}` : ""
      }...`;
      await showPageToast(
        "Uploading",
        uploadStartMsg,
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
          console.log("Upload successful:", result.url);

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
            "Upload Successful",
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
              "Original error information:",
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
                "Unable to get image, website may restrict external access";
            } else if (
              errorStr.includes("Unauthorized") ||
              errorStr.includes("403")
            ) {
              errorMessage =
                "Access denied, please check if Cloudflare ID is correct";
            } else {
              errorMessage = `Error: ${errorStr}`;
            }
          } else {
            errorMessage = "Unknown error occurred during upload";
          }

          console.error("Upload failed:", result.error);

          // Update toast to error state
          await showPageToast(
            "Upload Failed",
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
          "Get Failed",
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
        "Error",
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
      console.log(`Attempting to send toast message to tab #${activeTab.id}`);

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
      const toastType = title.includes("Successful")
        ? "success"
        : title.includes("Failed") || title.includes("Error")
        ? "error"
        : "info";
      const notificationId = `d2r2_${Date.now()}`;
      showPageToast(title, message, toastType, imageUrl, notificationId);

      console.log(
        `Preparing to show notification: ${title} - ${message}${
          imageUrl ? ` (URL: ${imageUrl})` : ""
        }`
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

  // Create or update right-click menu
  async function updateContextMenu() {
    try {
      // First clear existing menu
      await chrome.contextMenus.removeAll();
      console.log("Existing menu items cleared");

      // Get current configuration
      const config = await getConfig();
      const folders = parseFolderPath(config.folderPath);

      // Based on folder path count and hideRoot setting, decide menu structure
      if (!folders || folders.length === 0) {
        // Case 1: No folder path, create single menu item
        chrome.contextMenus.create(
          {
            id: ROOT_FOLDER_ID,
            title: "Drop to R2",
            contexts: ["image"],
          },
          checkMenuCreation
        );
        console.log("Single menu item created: Drop to R2");
      } else if (folders.length === 1 && config.hideRoot) {
        // Case 2: Single folder path with hideRoot enabled, create single menu item with folder name
        const folderName = folders[0];
        chrome.contextMenus.create(
          {
            id: `${FOLDER_PREFIX}0`,
            title: `Drop to R2 / ${folderName}`.replace(/\s*\/\s*/g, " / "),
            contexts: ["image"],
          },
          checkMenuCreation
        );
        console.log(`Single menu item created: Drop to R2 / ${folderName}`);
      } else {
        // Case 3: Multiple folder paths or hideRoot disabled, create parent menu and submenus
        // Create parent menu
        chrome.contextMenus.create(
          {
            id: PARENT_MENU_ID,
            title: "Drop to R2",
            contexts: ["image"],
          },
          checkMenuCreation
        );

        // Add "Upload to root directory" option if not hidden
        if (!config.hideRoot) {
          chrome.contextMenus.create(
            {
              id: ROOT_FOLDER_ID,
              parentId: PARENT_MENU_ID,
              title: "root" + " ".repeat(16),
              contexts: ["image"],
            },
            checkMenuCreation
          );
        }

        // Create submenus for each folder
        folders.forEach((folder, index) => {
          chrome.contextMenus.create(
            {
              id: `${FOLDER_PREFIX}${index}`,
              parentId: PARENT_MENU_ID,
              title: ` / ${folder}`.replace(/\s*\/\s*/g, " / "),
              contexts: ["image"],
            },
            checkMenuCreation
          );
        });

        console.log(
          `Menu created: Parent menu "D2R2" contains ${
            folders.length + (config.hideRoot ? 0 : 1)
          } subitems`
        );
      }

      // Register click event
      if (!chrome.contextMenus.onClicked.hasListener(handleMenuClick)) {
        chrome.contextMenus.onClicked.addListener(handleMenuClick);
        console.log("Menu click listener registered");
      }
    } catch (error) {
      console.error("Failed to create menu:", error);
    }
  }

  // Check menu creation status
  function checkMenuCreation() {
    if (chrome.runtime.lastError) {
      console.error("Menu creation failed:", chrome.runtime.lastError);
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

  // Handle menu click event
  async function handleMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ) {
    console.log("Menu item clicked:", info.menuItemId);

    if (!info.srcUrl) {
      console.error("Unable to get image URL");
      showNotification("Upload Failed", "Unable to get image URL");
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
        await handleImageUpload(info, targetFolder);
      } else {
        console.error("Invalid folder index");
        showNotification("Upload Failed", "Invalid target folder");
      }
    } else if (info.menuItemId === ROOT_FOLDER_ID) {
      // Upload to root directory
      await handleImageUpload(info, null);
    } else if (info.menuItemId === PARENT_MENU_ID) {
      // This is the parent menu, which shouldn't be clickable
      console.log("Parent menu clicked, no action taken");
    }
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
          "Please wait",
          "Extension initializing, please try again later...",
          "loading",
          undefined,
          uploadId
        );

        // Wait for a short period, check if initialization is completed
        let waitCount = 0;
        while (!extensionInitialized && waitCount < 5) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          waitCount++;
        }

        // Check again
        if (!extensionInitialized) {
          await showPageToast(
            "Unable to upload",
            "Extension initializing, please try again in a few seconds",
            "error",
            undefined,
            uploadId
          );
          return;
        } else {
          // Initialized, update status
          await showPageToast(
            "Ready",
            "Extension initialized completed, processing upload...",
            "info",
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
          "Configuration Error",
          "Please complete extension configuration"
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
        "Upload Failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  // Initialize when the extension loads
  initializeExtension();
});
