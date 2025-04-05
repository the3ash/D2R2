import { TOAST_STATUS } from "../state/types";

// Notification type definition
export type NotificationType = "success" | "error" | "info" | "loading";

// Toast direction definition
export type ToastDirection = "top" | "bottom";

// Notification item definition
interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  imageUrl?: string;
  timestamp: number;
  showSystem: boolean;
  showPage: boolean;
  processed: boolean;
  direction: ToastDirection;
  // Used to store the ID of the last loading type notification
  isActive?: boolean;
}

/**
 * Notification Manager - Singleton Pattern
 *
 * Handles all system notifications and page notifications, provides queue management
 */
class NotificationManager {
  private static instance: NotificationManager;
  private queue: NotificationItem[] = [];
  private processing: boolean = false;
  private lastNotificationTime: number = 0;
  private activeLoadingId: string | null = null;

  // Notification debounce time (ms)
  private readonly NOTIFICATION_DEBOUNCE = 1000; // Increased to 1 second
  // Queue processing interval (ms)
  private readonly QUEUE_PROCESS_INTERVAL = 300; // Increased interval
  // Maximum queue length
  private readonly MAX_QUEUE_LENGTH = 10;
  // Default notification direction
  private readonly DEFAULT_DIRECTION: ToastDirection = "top";

  private constructor() {
    // Start timer to process queue
    setInterval(() => this.processQueue(), this.QUEUE_PROCESS_INTERVAL);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
    }
    return NotificationManager.instance;
  }

  /**
   * Update existing notification
   * If notification ID exists, update its content; otherwise create a new notification
   */
  public updateNotification(
    id: string,
    title: string,
    message: string,
    type: NotificationType,
    options: {
      imageUrl?: string;
      showSystem?: boolean;
      showPage?: boolean;
      direction?: ToastDirection;
      forceShow?: boolean;
    } = {}
  ): string {
    const {
      imageUrl,
      showSystem = true,
      showPage = true,
      direction = this.DEFAULT_DIRECTION,
      forceShow = false,
    } = options;

    // Find existing notification
    const existingIndex = this.queue.findIndex((item) => item.id === id);

    if (existingIndex >= 0) {
      // Update existing notification
      const updatedNotification = {
        ...this.queue[existingIndex],
        title,
        message,
        type,
        imageUrl,
        showSystem,
        showPage,
        direction,
        processed: forceShow ? false : this.queue[existingIndex].processed, // If forceShow, mark as unprocessed to force display
        timestamp: forceShow ? Date.now() : this.queue[existingIndex].timestamp, // If forceShow, update timestamp
      };

      // Replace notification in queue
      this.queue[existingIndex] = updatedNotification;
      console.log(
        `Updated notification: ${id}, type: ${type}, message: ${message.substring(
          0,
          30
        )}...`
      );

      return id;
    } else {
      // Create new notification
      return this.addNotification(title, message, type, {
        imageUrl,
        showSystem,
        showPage,
        id,
        direction,
      });
    }
  }

  /**
   * Add notification to queue
   */
  public addNotification(
    title: string,
    message: string,
    type: NotificationType,
    options: {
      imageUrl?: string;
      showSystem?: boolean;
      showPage?: boolean;
      id?: string;
      direction?: ToastDirection;
    } = {}
  ): string {
    const {
      imageUrl,
      showSystem = true,
      showPage = true,
      id = `notification_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 9)}`,
      direction = this.DEFAULT_DIRECTION,
    } = options;

    // Clear unnecessary loading notifications
    if (type === "loading" && title === TOAST_STATUS.DROPPING) {
      // If there is an active loading notification, update it instead of creating a new one
      if (this.activeLoadingId) {
        return this.updateNotification(
          this.activeLoadingId,
          title,
          message,
          type,
          {
            imageUrl,
            showSystem,
            showPage,
            direction,
            forceShow: true,
          }
        );
      }

      // Remove all unprocessed loading notifications from the queue
      const loadingNotifications = this.queue.filter(
        (item) => item.type === "loading" && !item.processed
      );

      if (loadingNotifications.length > 0) {
        loadingNotifications.forEach((item) => {
          console.log(
            `Marking existing loading notification as processed: ${item.id}`
          );
          item.processed = true;
        });
      }

      // Record this new loading ID as active ID
      this.activeLoadingId = id;
    } else if (type !== "loading" && this.activeLoadingId) {
      // If it's not a loading type and there's an active loading ID, reset it
      // It could be a success or error notification
      console.log(
        `Resetting active loading ID ${this.activeLoadingId} for new ${type} notification`
      );
      this.activeLoadingId = null;
    }

    // Check if a similar notification is already in the queue - also check type
    const similarNotification = this.queue.find(
      (item) =>
        item.title === title &&
        item.message === message &&
        item.type === type &&
        !item.processed
    );

    if (similarNotification) {
      console.log(
        `Similar notification already in queue: ${id}, type: ${type}`
      );
      return similarNotification.id;
    }

    // Limit queue length
    if (this.queue.length >= this.MAX_QUEUE_LENGTH) {
      // Remove oldest unprocessed notification
      const oldestIndex = this.queue.findIndex((item) => !item.processed);
      if (oldestIndex >= 0) {
        console.log(
          `Queue full, removing oldest notification: ${this.queue[oldestIndex].id}`
        );
        this.queue.splice(oldestIndex, 1);
      } else {
        // If all notifications are processed, clean up half of them
        console.log(`Queue full with all processed, removing oldest half`);
        this.queue.splice(0, Math.floor(this.queue.length / 2));
      }
    }

    // Create new notification item
    const notification: NotificationItem = {
      id,
      title,
      message,
      type,
      imageUrl,
      timestamp: Date.now(),
      showSystem,
      showPage,
      processed: false,
      direction,
      isActive: type === "loading" && title === TOAST_STATUS.DROPPING,
    };

    // Add to queue
    this.queue.push(notification);
    console.log(
      `Added notification to queue: ${id}, type: ${type}, queue length: ${this.queue.length}`
    );

    return id;
  }

  /**
   * Process notification queue
   */
  private processQueue(): void {
    // If processing or queue is empty, return
    if (this.processing || this.queue.length === 0) {
      return;
    }

    // Check debounce time
    const now = Date.now();
    if (now - this.lastNotificationTime < this.NOTIFICATION_DEBOUNCE) {
      return;
    }

    // Find first unprocessed notification
    const notificationIndex = this.queue.findIndex((item) => !item.processed);
    if (notificationIndex === -1) {
      return; // All notifications are processed
    }

    // Mark as processing
    this.processing = true;

    const notification = this.queue[notificationIndex];
    console.log(
      `Processing notification: ${notification.id}, type: ${notification.type}`
    );

    // Update timestamp
    this.lastNotificationTime = now;

    // Mark as processed
    notification.processed = true;

    // Display notification
    this.displayNotification(notification).finally(() => {
      this.processing = false;
    });
  }

  /**
   * Display notification (system and/or page)
   */
  private async displayNotification(
    notification: NotificationItem
  ): Promise<void> {
    const {
      id,
      title,
      message,
      type,
      imageUrl,
      showSystem,
      showPage,
      direction,
    } = notification;

    try {
      // Display page notification
      if (showPage) {
        await this.displayPageToast(
          id,
          title,
          message,
          type,
          direction,
          imageUrl
        );
      }

      // Display system notification
      if (showSystem) {
        await this.displaySystemNotification(id, title, message, imageUrl);
      }
    } catch (error) {
      console.error(`Error displaying notification ${id}:`, error);
    }
  }

  /**
   * Display page Toast notification
   */
  private async displayPageToast(
    id: string,
    title: string,
    message: string,
    type: NotificationType,
    direction: ToastDirection,
    imageUrl?: string
  ): Promise<void> {
    try {
      // Get current active tab
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tabs || !tabs[0]?.id) {
        console.error(`[Toast][${id}] Unable to get current active tab`);
        return;
      }

      const activeTab = tabs[0];
      console.log(
        `[Toast][${id}] ${title}: ${message.substring(0, 50)}${
          message.length > 50 ? "..." : ""
        }`
      );

      // Check tab URL to ensure it's not on a special page
      if (
        activeTab.url &&
        (activeTab.url.startsWith("chrome://") ||
          activeTab.url.startsWith("chrome-extension://") ||
          activeTab.url.startsWith("about:"))
      ) {
        console.log(
          `[Toast][${id}] Cannot show toast on special page: ${activeTab.url}`
        );
        return;
      }

      // Send message to content script, including direction parameter
      return new Promise<void>((resolve) => {
        const tabId = activeTab.id as number;
        chrome.tabs.sendMessage(
          tabId,
          {
            action: "showToast",
            data: {
              title,
              message,
              type,
              imageUrl,
              toastId: id,
              direction, // Add direction parameter
            },
          },
          (response) => {
            // Check error but don't block execution
            const hasError = chrome.runtime.lastError;
            if (hasError) {
              console.log(
                `[Toast][${id}] Toast message may have failed (normal if page doesn't allow injection):`,
                hasError
              );
              resolve();
              return;
            }

            if (response && response.success) {
              console.log(`[Toast][${id}] Toast displayed on page`);
            } else if (response) {
              console.error(
                `[Toast][${id}] Toast display failed:`,
                response.error || "Unknown reason"
              );
            } else {
              console.log(
                `[Toast][${id}] No toast response received (content script may not be loaded)`
              );
            }

            resolve();
          }
        );
      });
    } catch (error) {
      console.error(`[Toast][${id}] Error showing page toast:`, error);
    }
  }

  /**
   * Display system notification
   */
  private async displaySystemNotification(
    id: string,
    title: string,
    message: string,
    imageUrl?: string
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        console.log(
          `[System][${id}] ${title}: ${message.substring(0, 50)}${
            message.length > 50 ? "..." : ""
          }${imageUrl ? ` (URL: ${imageUrl})` : ""}`
        );

        // Ensure there's notification permission
        chrome.permissions.contains(
          { permissions: ["notifications"] },
          (hasPermission) => {
            if (!hasPermission) {
              console.error(
                `[System][${id}] No notification permission, cannot show notification`
              );
              resolve();
              return;
            }

            // Notification click handling function
            const handleNotificationClick = (clickedId: string) => {
              if (clickedId === id && imageUrl) {
                console.log(
                  `[System][${id}] Notification clicked, opening URL: ${imageUrl}`
                );
                chrome.tabs.create({ url: imageUrl });
                // Remove notification
                chrome.notifications.clear(clickedId);
                // Remove listener
                chrome.notifications.onClicked.removeListener(
                  handleNotificationClick
                );
              }
            };

            // Add click listener (if there's a URL)
            if (imageUrl) {
              chrome.notifications.onClicked.addListener(
                handleNotificationClick
              );
            }

            // Get icon absolute URL
            const iconUrl = chrome.runtime.getURL("icon/48.png");

            chrome.notifications.create(
              id,
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
                    `[System][${id}] Notification creation failed:`,
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
                    `[System][${id}] Notification created successfully, ID: ${createdId}`
                  );
                }
                resolve();
              }
            );
          }
        );
      } catch (error) {
        console.error(`[System][${id}] Error showing notification:`, error);
        resolve();
      }
    });
  }

  /**
   * Clean up old notifications
   */
  public cleanupOldNotifications(): void {
    const now = Date.now();
    const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

    // Remove old processed notifications
    this.queue = this.queue.filter(
      (item) => !item.processed || now - item.timestamp < MAX_AGE_MS
    );

    console.log(
      `Cleaned up old notifications, queue length: ${this.queue.length}`
    );
  }
}

// Clean up old notifications every 5 minutes
setInterval(() => {
  NotificationManager.getInstance().cleanupOldNotifications();
}, 5 * 60 * 1000);

/**
 * Display processing notification
 * Create or update existing processing notification for upload process
 */
export function showProcessingNotification(
  info: chrome.contextMenus.OnClickData,
  message: string = "Processing image"
): string {
  // Get notification manager instance
  const manager = NotificationManager.getInstance();

  // Query existing active loading notification ID
  const activeId = (manager as any).activeLoadingId;

  if (activeId) {
    // If there's an active notification ID, update it
    return manager.updateNotification(
      activeId,
      TOAST_STATUS.DROPPING,
      message,
      "loading",
      {
        showSystem: true,
        showPage: true,
        direction: "top",
        forceShow: true,
      }
    );
  } else {
    // Otherwise create new notification
    return showNotification(TOAST_STATUS.DROPPING, message, "loading", {
      showSystem: true,
      showPage: true,
      direction: "top",
    });
  }
}

/**
 * Unified display notification function
 */
export function showNotification(
  title: string,
  message: string,
  type: NotificationType | string,
  options: {
    imageUrl?: string;
    showSystem?: boolean;
    showPage?: boolean;
    id?: string;
    direction?: ToastDirection;
  } = {}
): string {
  // Ensure type is correct
  let notificationType: NotificationType = "info";
  if (
    type === "success" ||
    type === "error" ||
    type === "info" ||
    type === "loading"
  ) {
    notificationType = type;
  } else if (type === TOAST_STATUS.DONE) {
    notificationType = "success";
  } else if (type === TOAST_STATUS.FAILED) {
    notificationType = "error";
  } else if (type === TOAST_STATUS.DROPPING) {
    notificationType = "loading";
  }

  // Add to notification queue
  return NotificationManager.getInstance().addNotification(
    title,
    message,
    notificationType,
    options
  );
}

/**
 * Display Toast notification to page
 *
 * Compatible with old API, internally calls unified notification function
 */
export async function showPageToast(
  title: string,
  message: string,
  type: NotificationType | string,
  imageUrl?: string,
  toastId?: string
): Promise<string> {
  const manager = NotificationManager.getInstance();
  const activeId = (manager as any).activeLoadingId;

  // If it's a loading type and there's a toastId or active ID, try to update instead of create
  if (
    (type === "loading" || type === TOAST_STATUS.DROPPING) &&
    (toastId || activeId)
  ) {
    const idToUpdate = toastId || activeId;
    if (idToUpdate) {
      return manager.updateNotification(idToUpdate, title, message, "loading", {
        imageUrl,
        showSystem: false,
        showPage: true,
        direction: "top",
        forceShow: false,
      });
    }
  }

  return showNotification(title, message, type, {
    imageUrl,
    id: toastId,
    showSystem: false,
    showPage: true,
    direction: "top", // Always use fixed direction
  });
}
