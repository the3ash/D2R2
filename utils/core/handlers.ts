import {
  extensionStateManager,
  pageStateManager,
  uploadTaskManager,
} from "../state";
import { TOAST_STATUS } from "../state/types";
import {
  showNotification,
  showPageToast,
  showProcessingNotification,
} from "../notifications";
import { processMenuClick } from "../upload";
import { quickInitialize, performInitialization } from "./initialization";
import { handleError } from "../helpers";
import { updateContextMenu } from "../menu";

// Initial menu click handler - queues clicks if not ready
export async function handleMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
) {
  try {
    console.log("======= MENU CLICK START =======");
    console.log("Menu data:", {
      menuItemId: info.menuItemId,
      srcUrl: info.srcUrl ? info.srcUrl.substring(0, 50) + "..." : "none",
      tabId: tab?.id,
    });

    // Always immediately show a processing toast
    const uploadId = uploadTaskManager.createTask(info, tab);
    console.log(`Created task ID: ${uploadId}`);

    // 显示开始处理的通知
    await showPageToast(
      TOAST_STATUS.DROPPING,
      "Processing image upload...",
      "loading",
      undefined,
      uploadId
    );

    // 更新活动标签页信息
    if (tab?.id) {
      pageStateManager.setActiveTab(tab.id, tab.url);
    }

    // Force initialize on menu click to handle window switching
    console.log("Force initializing extension...");
    extensionStateManager.resetState();
    await quickInitialize();
    console.log("Force initialization completed");

    // 直接处理点击 - 同步等待完成
    try {
      console.log("Processing menu click for task:", uploadId);
      await processMenuClick(info, tab);
      console.log("Menu click processing completed for task:", uploadId);
    } catch (processingError) {
      console.error("Error processing menu click:", processingError);
      throw processingError; // 重新抛出异常，以便外层catch块处理
    }

    console.log("======= MENU CLICK COMPLETED =======");
  } catch (error) {
    console.error("======= MENU CLICK ERROR =======", error);
    const errorMessage = handleError(error, "handleMenuClick");

    // 确保错误状态正确显示
    try {
      showNotification(TOAST_STATUS.FAILED, errorMessage, "error");
      await showPageToast(
        TOAST_STATUS.FAILED,
        errorMessage,
        "error",
        undefined,
        `error_${Date.now()}`
      );
    } catch (notificationError) {
      console.error("Failed to show error notification:", notificationError);
    }

    // 添加到等待队列中
    pageStateManager.addPendingMenuClick(info, tab);
    console.log("Added to pending queue due to error");
  }
}

// Initialize extension
export async function initializeExtension() {
  try {
    console.log("Starting extension initialization...");

    // Get current active tab
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tabs && tabs[0]?.id) {
      pageStateManager.setActiveTab(tabs[0].id, tabs[0].url);
      console.log(`Initializing for active tab ${tabs[0].id}`);
    }

    // Core initialization
    await performInitialization("initializeExtension");

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
      handleError(iconError, "icon verification");
    }

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
  } catch (error) {
    const errorMessage = handleError(error, "extension initialization");
    showPageToast(
      TOAST_STATUS.FAILED,
      errorMessage,
      "error",
      undefined,
      `init_error_${Date.now()}`
    );
  }
}
