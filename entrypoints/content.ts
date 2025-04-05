import { defineContentScript } from "wxt/utils/define-content-script";
import "./content/toast.css";

declare const chrome: any;

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("D2R2 content script loaded");

    // Create toast container
    const setupToastContainer = () => {
      const container = document.createElement("div");
      container.className = "d2r2-toast-container";
      document.body.appendChild(container);
      return container;
    };

    const toastContainer = setupToastContainer();

    // Store current active upload toast
    let currentUploadToast: HTMLElement | null = null;
    let currentUploadTimeoutId: number | null = null;

    // Helper function to create toast element
    const createToastElement = (type: string, toastId: string) => {
      const toast = document.createElement("div");
      toast.className = `d2r2-toast d2r2-toast-${type}`;
      toast.dataset.toastId = toastId;
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
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px)";
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

        currentUploadToast.className = `d2r2-toast d2r2-toast-${type} show`;
        updateToastContent(currentUploadToast, displayTitle, message);

        if (type !== "loading") {
          currentUploadTimeoutId = window.setTimeout(
            () => removeToast(currentUploadToast!),
            1000
          );
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
      setTimeout(() => toast.classList.add("show"), 10);

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
