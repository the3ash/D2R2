import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "D2R2",
    description: "Drop images to Cloudflare R2",
    permissions: [
      "contextMenus",
      "storage",
      "notifications",
      "clipboardWrite", // Allow writing to clipboard
      "activeTab", // Allow accessing current tab
      "tabs", // Allow getting and manipulating tabs
    ],
    host_permissions: ["<all_urls>"],
    icons: {
      16: "icon/16.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAhm3X7qutsrskke84ltokTObnFJakd/d0XFQ6Ox2wQueHTGJrHNSys0hnLZOOYvvM6rkKTnUK0Uolq9eSjlSLdyUVwTBzsdKnCzWNpZSutOI31zLUs0lJuBEz8R0WnPVexWxvNZ4CesYnSCcnPFdpW4xKWLsUKMx6LHkAeQrjtLMuS0MQQj66pKzgELuDSUqQnGKC/GqrZRqKf7r9JqEX4Vqy+PZmfxrKHcXkZ833ULk8dE5VqiLAxkZyXJyne3Z0lJ3SY3HNR0tsWNbcnx9NcAtx0w6YIUuRZ55p45XMvDCmoAk7T/kIB6XJ8e9ZppD1dOfdPi+l/SnUvU5QQwIDAQAB",
  },
});
