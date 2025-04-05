import { defineContentScript } from "wxt/utils/define-content-script";
import "./content/toast.css";

declare const chrome: any;

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("D2R2 content script loaded");

    // Track if toast container exists
    let toastContainerExists = false;

    // Create toast container
    const setupToastContainer = () => {
      // If it already exists, remove it first (to avoid multiple containers when script is loaded multiple times)
      const existingContainer = document.querySelector(".d2r2-toast-container");
      if (existingContainer) {
        existingContainer.remove();
      }

      const container = document.createElement("div");
      container.className = "d2r2-toast-container";

      // Ensure container is always mounted to the top level of body
      const appendToBody = () => {
        if (document.body) {
          document.body.appendChild(container);
          toastContainerExists = true;
          console.log("D2R2 toast container appended to body");
        } else {
          console.warn(
            "Document body not available, will retry appending toast container"
          );
          setTimeout(appendToBody, 100);
        }
      };

      // Try to mount container
      appendToBody();

      return container;
    };

    const toastContainer = setupToastContainer();

    // Monitor DOM changes to ensure toast container is not removed
    const setupMutationObserver = () => {
      // Return if browser doesn't support MutationObserver
      if (!window.MutationObserver) {
        console.warn(
          "MutationObserver not supported, toast container may be unstable"
        );
        return;
      }

      // Create observer instance
      const observer = new MutationObserver((mutations) => {
        // If toast container has been removed, re-add it
        if (
          toastContainerExists &&
          !document.querySelector(".d2r2-toast-container")
        ) {
          console.warn("Toast container was removed, re-appending to body");
          toastContainerExists = false;
          setupToastContainer();
        }
      });

      // Configure observation options
      const config = {
        childList: true,
        subtree: true,
      };

      // Start observing document.body
      if (document.body) {
        observer.observe(document.body, config);
        console.log(
          "MutationObserver started watching for toast container removal"
        );
      } else {
        // If body doesn't exist, try again later
        setTimeout(() => setupMutationObserver(), 100);
      }
    };

    // Start monitoring
    setupMutationObserver();

    // Store current active upload toast
    let currentUploadToast: HTMLElement | null = null;
    let currentUploadTimeoutId: number | null = null;

    // Helper function to create toast element
    const createToastElement = (type: string, toastId: string) => {
      const toast = document.createElement("div");
      toast.className = `d2r2-toast d2r2-toast-${type}`;
      toast.dataset.toastId = toastId;
      // Use inline styles to control initial position
      toast.style.transform = "translateY(-20px)";
      toast.style.opacity = "0";
      toast.style.pointerEvents = "auto";
      return toast;
    };

    // Helper function to update toast content
    const updateToastContent = (
      toast: HTMLElement,
      title: string,
      message: string
    ) => {
      const iconElement = toast.querySelector(".d2r2-toast-icon");
      if (iconElement) {
        iconElement.innerHTML = "";
      }

      const titleElement = toast.querySelector(".d2r2-toast-title");
      if (titleElement) {
        titleElement.textContent = title;
      }

      const messageElement = toast.querySelector(".d2r2-toast-message");
      if (messageElement) {
        messageElement.textContent = message;
      }
    };

    // Helper function to remove toast
    const removeToast = (toast: HTMLElement) => {
      // First move up and fade out
      toast.style.transition = "opacity 0.2s, transform 0.2s";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-20px)";

      setTimeout(() => {
        toast.remove();
        if (toast === currentUploadToast) {
          currentUploadToast = null;
          currentUploadTimeoutId = null;
        }
      }, 200);
    };

    // Show toast notification
    const showToast = (
      title: string,
      message: string,
      type: "success" | "error" | "info" | "loading" = "info",
      imageUrl?: string,
      toastId?: string
    ) => {
      // Map title based on type
      const displayTitle =
        type === "loading"
          ? "Dropping"
          : type === "success"
          ? "Done"
          : type === "error"
          ? "Failed"
          : title;

      // If toastId is provided and matches current upload toast ID, update existing toast
      if (
        toastId &&
        currentUploadToast &&
        currentUploadToast.dataset.toastId === toastId
      ) {
        if (currentUploadTimeoutId !== null) {
          clearTimeout(currentUploadTimeoutId);
          currentUploadTimeoutId = null;
        }

        // Update class name but don't use show class
        currentUploadToast.className = `d2r2-toast d2r2-toast-${type}`;
        updateToastContent(currentUploadToast, displayTitle, message);

        // If not in loading state, set timer to remove
        if (type !== "loading") {
          currentUploadTimeoutId = window.setTimeout(
            () => removeToast(currentUploadToast!),
            1000
          );
        } else {
          // If in loading state, ensure it's displayed
          currentUploadToast.style.opacity = "1";
          currentUploadToast.style.transform = "translateY(0)";
        }

        return currentUploadToast;
      }

      // Create new toast
      const newToastId = toastId || `toast_${Date.now()}`;
      const toast = createToastElement(type, newToastId);

      if (type === "loading" && toastId) {
        if (currentUploadToast) {
          currentUploadToast.remove();
          if (currentUploadTimeoutId !== null) {
            clearTimeout(currentUploadTimeoutId);
            currentUploadTimeoutId = null;
          }
        }
        currentUploadToast = toast;
      }

      toast.innerHTML = `
        <div class="d2r2-toast-icon"></div>
        <div class="d2r2-toast-content">
          <div class="d2r2-toast-title">${displayTitle}</div>
          <div class="d2r2-toast-message">${message}</div>
        </div>
      `;

      toastContainer.appendChild(toast);

      // Use JavaScript to directly control animation, not relying on CSS classes
      // Ensure it appears from top to bottom
      requestAnimationFrame(() => {
        // Start from top, set styles first
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-20px)";

        // Force browser repaint
        toast.offsetHeight;

        // Set transition
        toast.style.transition = "opacity 0.3s, transform 0.3s";

        // Move to target position
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
      });

      if (type !== "loading") {
        const timeoutId = window.setTimeout(() => removeToast(toast), 1000);
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
          const { data } = message;
          if (!data) {
            console.error("Missing toast data");
            sendResponse({ success: false, error: "Missing toast data" });
            return;
          }
          const { title, message: msg, type, imageUrl, toastId } = data;
          showToast(title, msg, type, imageUrl, toastId);
          sendResponse({ success: true });
        }
      }
    );
  },
});
