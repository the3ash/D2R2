// Image upload types and utilities

// Response from the Cloudflare worker
export interface UploadResponse {
  success: boolean;
  url?: string;
  error?: string;
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
    console.log(`Uploading image: ${imageUrl.substring(0, 50)}...`);
    console.log(`Folder setting: ${folderName || "root directory"}`);

    // Handle data URL case
    if (imageUrl.startsWith("data:image/")) {
      console.log(
        "Data URL detected, preparing to convert to FormData upload..."
      );

      // Create Blob from data URL
      const mimeMatch = imageUrl.match(/^data:(image\/[^;]+);base64,/);
      if (!mimeMatch) {
        console.error("Cannot parse MIME type from data URL");
        return {
          success: false,
          error: "Invalid data URL format",
        };
      }

      const mimeType = mimeMatch[1];
      const base64Data = imageUrl.replace(/^data:image\/[^;]+;base64,/, "");

      // Decode base64 and create Blob
      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);

      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }

      const blob = new Blob([ab], { type: mimeType });

      // Generate unique filename
      const ext = mimeType.split("/")[1] || "jpg";
      const fileName = `image_${Date.now()}.${ext}`;

      // Create file object
      const file = new File([blob], fileName, { type: mimeType });

      // Create FormData and add necessary parameters
      const formData = new FormData();
      formData.append("file", file);
      formData.append("cloudflareId", cloudflareId);

      if (folderName) {
        formData.append("folderName", folderName);
      }

      // Send to Worker for processing
      console.log("Starting to upload data URL converted file...");
      const response = await fetch(workerUrl, {
        method: "POST",
        body: formData,
      });

      const responseData = await response.json();
      console.log("Data URL upload response:", responseData);

      return responseData;
    }

    // Regular URL processing logic
    const requestBody = {
      cloudflareId,
      folderName,
      imageUrl,
    };

    // If folder name is empty string, treat as null
    if (requestBody.folderName === "") {
      console.log("Folder name is empty, will be set to null");
      requestBody.folderName = null;
    }

    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: chrome.runtime.getURL(""),
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    console.log(`Worker response [${response.status}]: ${responseText}`);

    try {
      const data = JSON.parse(responseText);
      return data;
    } catch (parseError) {
      console.error("Failed to parse response:", parseError);
      console.log("Original response:", responseText);

      // Try to check if response contains a successful upload URL
      if (
        responseText.includes('"success":true') &&
        responseText.includes('"url"')
      ) {
        console.log(
          "Response seems to contain success information, trying to extract URL"
        );

        // Use regular expression to extract URL
        const urlMatch = responseText.match(/"url"\s*:\s*"([^"]+)"/);
        if (urlMatch && urlMatch[1]) {
          console.log("Successfully extracted URL:", urlMatch[1]);
          return {
            success: true,
            url: urlMatch[1],
            error: "Response format issue, URL has been extracted",
          };
        }
      }

      return {
        success: false,
        error:
          parseError instanceof Error
            ? `Response parsing error: ${parseError.message}`
            : `Response parsing error: ${String(parseError)}`,
      };
    }
  } catch (error) {
    console.error("Error occurred during upload:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
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
    // Form data for the file
    const formData = new FormData();
    formData.append("file", imageBlob, fileName);
    formData.append("cloudflareId", cloudflareId);
    if (folderName) {
      formData.append("folderName", folderName);
    }

    const response = await fetch(workerUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Worker responded with status: ${response.status}`,
      };
    }

    return await response.json();
  } catch (error) {
    console.error("Error uploading image blob:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
