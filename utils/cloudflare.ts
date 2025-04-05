// Image upload types and utilities

// Response from the Cloudflare worker
export interface UploadResponse {
  success: boolean;
  url?: string;
  error?: string;
}

// Helper function to handle errors consistently
function handleError(error: unknown, context: string): string {
  console.error(`Error in ${context}:`, error);
  return error instanceof Error ? error.message : String(error);
}

// Helper function to create FormData for upload
function createFormData(
  cloudflareId: string,
  folderName: string | null,
  file: File | Blob,
  fileName?: string
): FormData {
  const formData = new FormData();
  formData.append("file", file, fileName);
  formData.append("cloudflareId", cloudflareId);
  if (folderName) {
    formData.append("folderName", folderName);
  }
  return formData;
}

/**
 * Upload image from URL to R2 storage
 * @param workerUrl Worker URL
 * @param cloudflareId Cloudflare ID
 * @param folderName Optional folder name
 * @param imageUrl Image URL
 * @returns Upload result
 */
export async function uploadImageFromUrl(
  workerUrl: string,
  cloudflareId: string,
  folderName: string | null,
  imageUrl: string
): Promise<{ success: boolean; url?: string; error?: string; path?: string }> {
  try {
    // Handle data URL case
    if (imageUrl.startsWith("data:image/")) {
      const mimeMatch = imageUrl.match(/^data:(image\/[^;]+);base64,/);
      if (!mimeMatch) {
        return { success: false, error: "Invalid data URL format" };
      }

      const mimeType = mimeMatch[1];
      const base64Data = imageUrl.replace(/^data:image\/[^;]+;base64,/, "");
      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);

      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }

      const blob = new Blob([ab], { type: mimeType });
      const ext = mimeType.split("/")[1] || "jpg";
      const fileName = `image_${Date.now()}.${ext}`;
      const file = new File([blob], fileName, { type: mimeType });

      const formData = createFormData(cloudflareId, folderName, file);
      const response = await fetch(workerUrl, {
        method: "POST",
        body: formData,
      });
      return await response.json();
    }

    // Regular URL processing
    const requestBody = {
      cloudflareId,
      folderName: folderName || null,
      imageUrl,
    };

    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: chrome.runtime.getURL(""),
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();

    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      if (
        responseText.includes('"success":true') &&
        responseText.includes('"url"')
      ) {
        const urlMatch = responseText.match(/"url"\s*:\s*"([^"]+)"/);
        if (urlMatch && urlMatch[1]) {
          return {
            success: true,
            url: urlMatch[1],
            error: "Response format issue, URL has been extracted",
          };
        }
      }

      return {
        success: false,
        error: handleError(parseError, "Response parsing"),
      };
    }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, "Image upload"),
    };
  }
}

/**
 * Upload a blob directly
 */
export async function uploadImageBlob(
  workerUrl: string,
  cloudflareId: string,
  folderName: string | null,
  imageBlob: Blob,
  fileName: string
): Promise<UploadResponse> {
  try {
    const formData = createFormData(
      cloudflareId,
      folderName,
      imageBlob,
      fileName
    );
    const response = await fetch(workerUrl, { method: "POST", body: formData });

    if (!response.ok) {
      return {
        success: false,
        error: `Worker responded with status: ${response.status}`,
      };
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: handleError(error, "Blob upload"),
    };
  }
}
