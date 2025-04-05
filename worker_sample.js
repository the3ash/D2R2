/**
 * D2R2 Cloudflare Worker Sample
 *
 * This code demonstrates how to receive requests from D2R2 extension and upload images to R2
 * Using single bucket + folder path pattern
 * Required environment variables: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

// Allowed origin domains for enhanced security
const ALLOWED_ORIGINS = [
  "chrome-extension://gbhpfpkimkalpnhpfaeialjaddhmpmof", // Your extension ID
  // Add more extension IDs (development/production)
  // Consider adding local test domains
];

// Handle CORS preflight requests
async function handleCorsRequest(request) {
  console.log("Processing CORS preflight request");
  const origin = request.headers.get("Origin") || "*";

  // Allow specific origins or localhost in development
  if (
    origin.includes("chrome-extension://") ||
    origin.includes("localhost") ||
    origin.includes("chrome-extension:")
  ) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Origin",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

// Main request handling function
export default {
  async fetch(request, env, ctx) {
    // Print request information
    try {
      console.log("Received request:", request.method, request.url);
      console.log(
        "Request headers:",
        Object.fromEntries(request.headers.entries())
      );
    } catch (e) {
      console.error("Error printing request information:", e);
    }

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return handleCorsRequest(request);
    }

    // Handle test connection requests
    if (request.method === "GET") {
      return handleTestConnectionRequest(request, env);
    }

    // Handle file upload requests
    if (request.method === "POST") {
      // Check request content-type to determine handling method
      const contentType = request.headers.get("Content-Type") || "";

      console.log("Request content type:", contentType);

      if (contentType.includes("multipart/form-data")) {
        // Handle FormData format file uploads
        console.log("Detected FormData file upload request");
        return handleFileRequest(request, env);
      } else {
        // Handle JSON format URL uploads
        console.log("Detected JSON image URL upload request");
        return handleImageUrlRequest(request, env);
      }
    }

    // Unsupported request types
    return new Response("Method not allowed", { status: 405 });
  },
};

// Handle test connection requests
async function handleTestConnectionRequest(request, env) {
  try {
    console.log("Processing test connection request...");
    const origin = request.headers.get("Origin") || "*";
    const url = new URL(request.url);

    // Check if R2 bucket is accessible
    let r2Status = "Unknown";
    try {
      // Try to list an object to verify R2 connection
      const bucketExists = env.BUCKET_NAME != null;
      r2Status = bucketExists ? "Available" : "Unavailable";
    } catch (error) {
      console.error("Error checking R2 status:", error);
      r2Status = "Error";
    }

    // Build response data
    const responseData = {
      success: true,
      message: "D2R2 Worker connection normal",
      timestamp: new Date().toISOString(),
      workerInfo: {
        r2Status: r2Status,
        region: request.cf ? request.cf.colo : "Unknown",
        clientIP: request.headers.get("CF-Connecting-IP") || "Unknown",
      },
      requestPath: url.pathname,
      version: "1.0.0",
    };

    // Return JSON response
    return new Response(JSON.stringify(responseData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error processing test connection request:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Unknown error",
        message: "Test connection failed",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
        },
      }
    );
  }
}

// Handle JSON format requests (containing image URL)
async function handleImageUrlRequest(request, env) {
  try {
    console.log("Processing JSON request...");
    const origin = request.headers.get("Origin") || "*";

    const requestData = await request.json();
    console.log("Received JSON data", {
      hasCloudflareId: !!requestData.cloudflareId,
      hasFolderName: !!requestData.folderName,
      folderName: requestData.folderName,
      hasImageUrl: !!requestData.imageUrl,
    });

    const { cloudflareId, folderName, imageUrl } = requestData;

    // Validate parameters
    if (!cloudflareId || !imageUrl) {
      console.error("Missing required parameters");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required parameters",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // Ensure folderName is null or valid string
    const cleanFolderName =
      folderName && typeof folderName === "string" && folderName.trim() !== ""
        ? folderName.trim()
        : null;

    // Get image from URL
    console.log(
      "Starting to get image from URL:",
      imageUrl.substring(0, 50) + "..."
    );
    console.log(
      "Folder setting:",
      cleanFolderName ? `"${cleanFolderName}"` : "Root directory"
    );

    // More robust image fetching method to bypass anti-hotlinking
    let imageResponse;
    const originalUrl = imageUrl;

    // Check if URL parameters need to be modified to bypass anti-hotlinking
    let modifiedUrl = new URL(imageUrl);

    // 1. Add random parameters to bypass cache checks
    modifiedUrl.searchParams.append("_r2nocache", Date.now().toString());

    // 2. If URL doesn't contain referer parameter, try adding it
    if (!modifiedUrl.searchParams.has("referer")) {
      try {
        // Extract possible referrer websites
        const referer = new URL(originalUrl).origin;
        modifiedUrl.searchParams.append("referer", referer);
      } catch (e) {
        console.log("Cannot add referer parameter:", e);
      }
    }

    // Define all image fetching attempt methods
    const fetchAttempts = [
      // Attempt 1: Use modified URL with complete headers
      async () => {
        console.log("Attempt 1: Use modified URL with custom headers...");
        return await fetch(modifiedUrl.toString(), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            Accept:
              "image/webp,image/avif,image/png,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Referer: new URL(imageUrl).origin,
            "sec-ch-ua":
              '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          cf: {
            cacheEverything: false,
            scrapeShield: false,
          },
          redirect: "follow",
        });
      },

      // Attempt 2: Use original URL with different referer
      async () => {
        console.log("Attempt 2: Use original URL with different referer...");
        return await fetch(originalUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            Accept:
              "image/webp,image/avif,image/png,image/svg+xml,image/*,*/*;q=0.8",
            Referer: "https://www.google.com/",
          },
        });
      },

      // Attempt 3: Use image proxy service
      async () => {
        // Use Google's image proxy
        const proxyUrl = `https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&url=${encodeURIComponent(
          originalUrl
        )}`;
        console.log("Attempt 3: Use Google image proxy...");
        return await fetch(proxyUrl);
      },

      // Attempt 4: Use AllOrigins proxy
      async () => {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(
          originalUrl
        )}`;
        console.log("Attempt 4: Use AllOrigins proxy...");
        return await fetch(proxyUrl);
      },

      // Attempt 5: Use ImgProxy technology (replace with actual imgproxy service if needed)
      async () => {
        // Example: const proxyUrl = `https://your-imgproxy.service/insecure/plain/${encodeURIComponent(originalUrl)}`;
        const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(
          originalUrl
        )}`;
        console.log("Attempt 5: Use wsrv.nl image proxy service...");
        return await fetch(proxyUrl);
      },
    ];

    // Try all methods in sequence until success or all fail
    let lastError = null;
    for (const attemptFn of fetchAttempts) {
      try {
        imageResponse = await attemptFn();

        if (imageResponse.ok) {
          console.log("Successfully obtained image!", imageResponse.status);
          break; // Successfully obtained, break loop
        } else {
          console.log(
            `Failed to get image, status code: ${imageResponse.status}`
          );
          lastError = new Error(`HTTP error: ${imageResponse.status}`);
        }
      } catch (error) {
        console.error("Failed to get image:", error);
        lastError = error;
        // Continue to next attempt
      }
    }

    // Check if all attempts failed
    if (!imageResponse || !imageResponse.ok) {
      console.error("All image fetching attempts failed:", lastError);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Cannot get image: ${lastError?.message || "Unknown error"}`,
          details: "Website may have strict anti-hotlinking protection",
          solutions: [
            "Try getting image from different website",
            "Or use image without anti-hotlinking",
          ],
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // Get filename and content type
    const contentType =
      imageResponse.headers.get("Content-Type") || "application/octet-stream";
    console.log("Image content type:", contentType);

    const urlParts = new URL(imageUrl).pathname.split("/");
    let fileName = urlParts[urlParts.length - 1];

    // Ensure file extension exists
    if (!fileName || !fileName.includes(".")) {
      const ext = contentType.split("/")[1] || "jpg";
      fileName = `image_${Date.now()}.${ext}`;
    }
    console.log("Filename:", fileName);

    // Build storage path (using folder path)
    const objectKey = cleanFolderName
      ? `${cleanFolderName}/${fileName}`
      : fileName;
    console.log("Storage path:", objectKey);

    // Get image data
    const imageData = await imageResponse.arrayBuffer();
    console.log("Received image data, size:", imageData.byteLength, "bytes");

    try {
      // Upload to R2 (using bound single bucket)
      console.log("Starting to upload to R2...");
      await env.BUCKET_NAME.put(objectKey, imageData, {
        httpMetadata: {
          contentType,
        },
      });
      console.log("Uploaded to R2 successfully");
    } catch (r2Error) {
      console.error("R2 upload error:", r2Error);
      return new Response(
        JSON.stringify({
          success: false,
          error: `R2 storage error: ${r2Error.message || "Unknown R2 error"}`,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    }

    // Get actual bound bucket name
    // Note: Here we get the actual name through env R2 binding
    // Please adjust this code according to R2 API support when actually deploying
    const actualBucketName = env.BUCKET_NAME_META?.name || "your-bucket"; // Adjust according to actual situation
    console.log("Bucket name:", actualBucketName);

    // Build access URL - use actual bucket name
    const publicUrl = `https://${actualBucketName}.${cloudflareId}.r2.cloudflarestorage.com/${objectKey}`;
    console.log("Generated URL:", publicUrl);

    return new Response(
      JSON.stringify({
        success: true,
        url: publicUrl,
        path: objectKey,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      }
    );
  } catch (error) {
    console.error("Error processing JSON request:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
        },
      }
    );
  }
}

// Handle form file upload requests
async function handleFileRequest(request, env) {
  try {
    const formData = await request.formData();

    const file = formData.get("file");
    const cloudflareId = formData.get("cloudflareId");
    const folderName = formData.get("folderName");

    // Validate parameters
    if (!file || !cloudflareId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required parameters",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Build storage path (using folder path)
    const fileName = file.name;
    const objectKey = folderName ? `${folderName}/${fileName}` : fileName;

    // Upload to R2 (using bound single bucket)
    await env.BUCKET_NAME.put(objectKey, file, {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Get actual bound bucket name
    const actualBucketName = env.BUCKET_NAME_META?.name || "your-bucket";

    // Build access URL - use actual bucket name
    const publicUrl = `https://${actualBucketName}.${cloudflareId}.r2.cloudflarestorage.com/${objectKey}`;

    return new Response(
      JSON.stringify({
        success: true,
        url: publicUrl,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": request.headers.get("Origin"),
        },
      }
    );
  } catch (error) {
    console.error("Error processing file upload:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": request.headers.get("Origin"),
        },
      }
    );
  }
}
