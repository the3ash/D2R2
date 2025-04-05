import { defineContentScript } from "wxt/utils/define-content-script";

const toastStyles = `
.d2r2-toast-container {
  position: fixed;
  z-index: 9999;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 350px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.d2r2-toast {
  background-color: #0d0d0d;
  color: white;
  padding: 6px 12px;
  border-radius: 10px;
  margin-top: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  display: flex;
  align-items: center;
  opacity: 0;
  transform: translateY(-20px);
  transition: opacity 0.3s, transform 0.3s;
  animation: fadeIn 0.3s ease-in-out;
  font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

.d2r2-toast.show {
  opacity: 1;
  transform: translateY(0);
}

.d2r2-toast-icon {
  margin-right: 8px;
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.d2r2-toast-content {
  flex-grow: 1;
}

.d2r2-toast-title {
  font-weight: normal;
  font-size: 13px;
  line-height: 20px;
}

.d2r2-toast-message {
  display: none;
}

.d2r2-toast-success .d2r2-toast-icon {
  background-color: #00C7BE;
}

.d2r2-toast-error .d2r2-toast-icon {
  background-color: #FF2D55;
}


.d2r2-toast-loading .d2r2-toast-icon {
  background-color: #999999;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

declare const chrome: any;

export default defineContentScript({
  matches: ["<all_urls>"], // Match all websites
  main() {
    console.log("D2R2 content script loaded");

    // Create toast container and styles
    const setupToastContainer = () => {
      // Add styles
      const style = document.createElement("style");
      style.textContent = toastStyles;
      document.head.appendChild(style);

      // Create toast container
      const container = document.createElement("div");
      container.className = "d2r2-toast-container";
      document.body.appendChild(container);

      return container;
    };

    const toastContainer = setupToastContainer();

    // Store current active upload toast
    let currentUploadToast: HTMLElement | null = null;
    let currentUploadTimeoutId: number | null = null;

    // Show toast notification
    const showToast = (
      title: string,
      message: string,
      type: "success" | "error" | "info" | "loading" = "info",
      imageUrl?: string,
      toastId?: string
    ) => {
      // Map title based on type
      let displayTitle = title;
      if (type === "loading") {
        displayTitle = "Dropping";
      } else if (type === "success") {
        displayTitle = "Done";
      } else if (type === "error") {
        displayTitle = "Failed";
      }

      // If toastId is provided and matches current upload toast ID, update existing toast
      if (
        toastId &&
        currentUploadToast &&
        currentUploadToast.dataset.toastId === toastId
      ) {
        // Clear auto-remove timer
        if (currentUploadTimeoutId !== null) {
          clearTimeout(currentUploadTimeoutId);
          currentUploadTimeoutId = null;
        }

        // Update toast type
        currentUploadToast.className = `d2r2-toast d2r2-toast-${type} show`;

        // Update content
        let messageContent = message;

        const iconElement =
          currentUploadToast.querySelector(".d2r2-toast-icon");
        if (iconElement) {
          iconElement.innerHTML = "";
        }

        const titleElement =
          currentUploadToast.querySelector(".d2r2-toast-title");
        if (titleElement) {
          titleElement.textContent = displayTitle;
        }

        const messageElement = currentUploadToast.querySelector(
          ".d2r2-toast-message"
        );
        if (messageElement) {
          messageElement.textContent = message;
        }

        // If not in loading state, set auto-remove timer
        if (type !== "loading") {
          currentUploadTimeoutId = window.setTimeout(() => {
            if (currentUploadToast) {
              currentUploadToast.style.opacity = "0";
              currentUploadToast.style.transform = "translateY(20px)";
              setTimeout(() => {
                if (currentUploadToast) {
                  currentUploadToast.remove();
                  currentUploadToast = null;
                }
              }, 200);
            }
          }, 1000);
        }

        return currentUploadToast;
      }

      // Create new toast
      const toast = document.createElement("div");
      const newToastId = toastId || `toast_${Date.now()}`;
      toast.className = `d2r2-toast d2r2-toast-${type}`;
      toast.dataset.toastId = newToastId;

      // If it's an upload toast, store reference
      if (type === "loading" && toastId) {
        // If there's already an upload toast, remove it first
        if (currentUploadToast) {
          currentUploadToast.remove();
          if (currentUploadTimeoutId !== null) {
            clearTimeout(currentUploadTimeoutId);
            currentUploadTimeoutId = null;
          }
        }
        currentUploadToast = toast;
      }

      // Build toast content
      let messageContent = message;

      toast.innerHTML = `
        <div class="d2r2-toast-icon"></div>
        <div class="d2r2-toast-content">
          <div class="d2r2-toast-title">${displayTitle}</div>
          <div class="d2r2-toast-message">${messageContent}</div>
        </div>
      `;

      // Add to container
      toastContainer.appendChild(toast);

      // Apply animation
      setTimeout(() => {
        toast.classList.add("show");
      }, 10);

      // If not in loading state, set auto-remove timer
      if (type !== "loading") {
        const timeoutId = window.setTimeout(() => {
          toast.style.opacity = "0";
          toast.style.transform = "translateY(20px)";
          setTimeout(() => {
            toast.remove();
            if (toast === currentUploadToast) {
              currentUploadToast = null;
              currentUploadTimeoutId = null;
            }
          }, 200);
        }, 1000);

        if (toast === currentUploadToast) {
          currentUploadTimeoutId = timeoutId;
        }
      }

      return toast;
    };

    // Listen for messages from background
    chrome.runtime.onMessage.addListener(
      (message: any, sender: any, sendResponse: (response?: any) => void) => {
        console.log("Content script received message:", message);

        if (message.action === "showToast") {
          const {
            title,
            message: msg,
            type,
            imageUrl,
            toastId,
          } = message.data || {};
          if (title && msg) {
            showToast(title, msg, type, imageUrl, toastId);
            sendResponse({ success: true });
          } else {
            sendResponse({
              success: false,
              error: "Missing notification title or content",
            });
          }
          return true;
        }

        // Process the message to update the toast
        if (message.action === "updateToast") {
          const {
            title,
            message: msg,
            type,
            imageUrl,
            toastId,
          } = message.data || {};
          if (title && msg && toastId) {
            showToast(title, msg, type, imageUrl, toastId);
            sendResponse({ success: true });
          } else {
            sendResponse({
              success: false,
              error: "Missing required fields for updating toast",
            });
          }
          return true;
        }

        // Respond to ping to confirm content script is loaded
        if (message.action === "ping") {
          console.log(
            "Received ping request, confirming content script is loaded"
          );
          sendResponse({ success: true, loaded: true });
          return true;
        }
      }
    );
  },
});
