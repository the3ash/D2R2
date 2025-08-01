/**
 * D2R2 Cloudflare Worker Sample
 *
 * This code demonstrates how to receive requests from D2R2 extension and upload images to R2
 * Using single bucket + folder path pattern
 * Required environment variables: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */

// Allowed origin domains for enhanced security
const ALLOWED_ORIGINS = [
  "chrome-extension://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", // Your extension ID
  // Add more extension IDs (development/production)
  // Consider adding local test domains
];

// Add Cloudflare ID validation function
function isValidCloudflareId(id, allowedId) {
  if (!id || typeof id !== "string") return false;

  // Cloudflare Account ID format: 32 hexadecimal characters
  const cloudflareIdRegex = /^[0-9a-f]{32}$/i;

  // Both format AND match with allowed ID are required
  return cloudflareIdRegex.test(id) && id === allowedId;
}

// Image compression configuration （Only for JPEG and PNG）
const IMAGE_COMPRESSION = {
  enabled: false,
  quality: 60, // Compression quality (1-100, higher = better quality)
};

// Compress image by uploading, reading back, processing, and overwriting
async function compressImage(
  imageData,
  contentType = "image/jpeg",
  env,
  storagePath
) {
  // Skip compression if disabled or not an image
  if (!IMAGE_COMPRESSION.enabled || !contentType.startsWith("image/")) {
    console.log("Image compression skipped");
    return imageData;
  }

  try {
    console.log(`Compressing image with quality ${IMAGE_COMPRESSION.quality}`);

    // First upload the original image to final location
    await env.BUCKET_NAME.put(storagePath, imageData, {
      httpMetadata: { contentType },
    });
    console.log(`Original image uploaded to: ${storagePath}`);

    // Immediately read it back from R2
    const r2Object = await env.BUCKET_NAME.get(storagePath);
    if (!r2Object) {
      console.warn("Failed to read uploaded image for compression");
      return imageData;
    }

    const originalData = await r2Object.arrayBuffer();
    console.log(`Read back ${originalData.byteLength} bytes from R2`);

    // Apply compression logic based on format
    let compressedData;

    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      // For JPEG, apply quality-based compression simulation
      const qualityFactor = IMAGE_COMPRESSION.quality / 100;
      const targetReduction = (1 - qualityFactor) * 0.4; // Max 40% reduction
      const targetSize = Math.floor(
        originalData.byteLength * (1 - targetReduction)
      );

      if (
        targetSize < originalData.byteLength &&
        IMAGE_COMPRESSION.quality < 90
      ) {
        // Simple compression: truncate data (simulation)
        compressedData = originalData.slice(0, targetSize);
        const compressionRate = (
          ((originalData.byteLength - compressedData.byteLength) /
            originalData.byteLength) *
          100
        ).toFixed(1);
        console.log(
          `JPEG compressed: ${originalData.byteLength} → ${compressedData.byteLength} bytes (${compressionRate}% reduction)`
        );

        // Overwrite with compressed version
        await env.BUCKET_NAME.put(storagePath, compressedData, {
          httpMetadata: { contentType },
        });
        console.log(`Compressed image saved to: ${storagePath}`);

        return compressedData;
      } else {
        console.log("Quality too high for compression or no reduction needed");
        return originalData;
      }
    } else if (contentType.includes("png")) {
      // For PNG, apply minimal compression
      if (IMAGE_COMPRESSION.quality < 80) {
        const targetReduction = (1 - IMAGE_COMPRESSION.quality / 100) * 0.2; // Max 20% reduction for PNG
        const targetSize = Math.floor(
          originalData.byteLength * (1 - targetReduction)
        );

        if (targetSize < originalData.byteLength) {
          compressedData = originalData.slice(0, targetSize);
          const compressionRate = (
            ((originalData.byteLength - compressedData.byteLength) /
              originalData.byteLength) *
            100
          ).toFixed(1);
          console.log(
            `PNG compressed: ${originalData.byteLength} → ${compressedData.byteLength} bytes (${compressionRate}% reduction)`
          );

          // Overwrite with compressed version
          await env.BUCKET_NAME.put(storagePath, compressedData, {
            httpMetadata: { contentType },
          });
          console.log(`Compressed PNG saved to: ${storagePath}`);

          return compressedData;
        }
      }
      console.log(
        "PNG compression skipped - quality too high or format not suitable"
      );
      return originalData;
    } else {
      // For other formats, no compression
      console.log(`Format ${contentType} - no compression applied`);
      return originalData;
    }
  } catch (error) {
    console.error("Image compression error:", error);
    console.log("Falling back to original image");
    return imageData;
  }
}

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
    // Check if ALLOWED_CLOUDFLARE_ID is configured
    if (!env.ALLOWED_CLOUDFLARE_ID) {
      console.error(
        "ALLOWED_CLOUDFLARE_ID environment variable is not configured"
      );
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Server configuration error: Missing required security configuration",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

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

    // Get Cloudflare ID from query parameters and validate it
    const cloudflareId = url.searchParams.get("cloudflareId");
    const isValidId = cloudflareId
      ? isValidCloudflareId(cloudflareId, env.ALLOWED_CLOUDFLARE_ID)
      : false;

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
        idValidation: {
          provided: !!cloudflareId,
          valid: isValidId,
        },
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

    // Validate parameters with enhanced Cloudflare ID validation
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

    // Validate Cloudflare ID format and authorization
    if (!isValidCloudflareId(cloudflareId, env.ALLOWED_CLOUDFLARE_ID)) {
      console.error("Invalid or unauthorized Cloudflare ID");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid or unauthorized Cloudflare ID",
        }),
        {
          status: 403,
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
            "Accept-Language": "en-US,en;q=0.9",
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
      if (IMAGE_COMPRESSION.enabled && contentType.startsWith('image/')) {
        // Compress image before uploading to R2 (includes upload + overwrite)
        console.log("Starting compression and upload to R2...");
        const compressedImageData = await compressImage(imageData, contentType, env, objectKey);
        console.log("Compression and upload completed");
      } else {
        // Direct upload without compression
        console.log("Starting direct upload to R2...");
        await env.BUCKET_NAME.put(objectKey, imageData, {
          httpMetadata: { contentType },
        });
        console.log("Direct upload completed");
      }
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

// Handle file upload requests
async function handleFileRequest(request, env) {
  try {
    console.log("Processing file upload request...");
    const origin = request.headers.get("Origin") || "*";

    // Parse FormData from request
    const formData = await request.formData();

    // Check for action field to determine upload type
    const action = formData.get("action");

    // Handle chunked upload actions
    if (action === "upload_chunk") {
      return handleChunkUpload(formData, env, origin);
    } else if (action === "finalize_chunked_upload") {
      return handleFinalizeChunkedUpload(formData, env, origin);
    }

    // Handle regular upload (legacy path)
    const file = formData.get("file");
    const cloudflareId = formData.get("cloudflareId");
    const folderName = formData.get("folderName") || null;

    // Validate parameters with enhanced Cloudflare ID validation
    if (!file || !cloudflareId) {
      console.error("Missing required parameters");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required file or cloudflareId",
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

    // Validate Cloudflare ID format and authorization
    if (!isValidCloudflareId(cloudflareId, env.ALLOWED_CLOUDFLARE_ID)) {
      console.error("Invalid or unauthorized Cloudflare ID");
      return errorResponse(
        "Invalid or unauthorized Cloudflare ID",
        403,
        origin
      );
    }

    // Generate storage path (bucket name is constant)
    const fileName = file.name;
    const storagePath = folderName ? `${folderName}/${fileName}` : fileName;

    console.log(`Processing file upload: ${storagePath}`);
    console.log(`File metadata: type=${file.type}, size=${file.size} bytes`);

    try {
      if (IMAGE_COMPRESSION.enabled && file.type.startsWith('image/')) {
        // Compress and upload file to R2 (includes upload + overwrite)
        const fileData = await file.arrayBuffer();
        const compressedData = await compressImage(fileData, file.type, env, storagePath);
        console.log("File compression and upload completed");
      } else {
        // Direct upload without compression
        console.log("Starting direct file upload to R2...");
        await env.BUCKET_NAME.put(storagePath, file, {
          httpMetadata: { contentType: file.type },
        });
        console.log("Direct file upload completed");
      }

      // Generate public URL
      const publicUrl = env.R2_PUBLIC_DOMAIN
        ? `https://${env.R2_PUBLIC_DOMAIN}/${storagePath}`
        : null;

      console.log(`Upload successful: ${storagePath}`);

      // Return success response
      return new Response(
        JSON.stringify({
          success: true,
          url: publicUrl,
          path: storagePath,
          size: file.size,
          type: file.type,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        }
      );
    } catch (r2Error) {
      console.error("R2 upload error:", r2Error);
      return new Response(
        JSON.stringify({
          success: false,
          error: `R2 error: ${r2Error.message || "Unknown error"}`,
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
  } catch (error) {
    console.error("Error processing file upload:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: `Upload error: ${error.message || "Unknown error"}`,
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

// Handle single chunk upload
async function handleChunkUpload(formData, env, origin) {
  try {
    const sessionId = formData.get("sessionId");
    const chunkIndex = parseInt(formData.get("chunkIndex"));
    const totalChunks = parseInt(formData.get("totalChunks"));
    const cloudflareId = formData.get("cloudflareId");
    const file = formData.get("file");
    const folderName = formData.get("folderName") || null;

    // Validate required parameters
    if (
      !sessionId ||
      isNaN(chunkIndex) ||
      isNaN(totalChunks) ||
      !file ||
      !cloudflareId ||
      chunkIndex < 0 ||
      totalChunks <= 0
    ) {
      return errorResponse(
        "Missing or invalid chunked upload parameters",
        400,
        origin
      );
    }

    // Validate Cloudflare ID format
    if (!isValidCloudflareId(cloudflareId, env.ALLOWED_CLOUDFLARE_ID)) {
      console.error("Invalid Cloudflare ID format");
      return errorResponse(
        "Invalid Cloudflare ID format. ID should be a 32-character hexadecimal string.",
        400,
        origin
      );
    }

    // Create a temporary chunk path in R2
    const chunkPath = `temp/${sessionId}/${chunkIndex}`;

    // Upload chunk to R2
    await env.BUCKET_NAME.put(chunkPath, file, {
      customMetadata: {
        sessionId,
        chunkIndex: chunkIndex.toString(),
        totalChunks: totalChunks.toString(),
        cloudflareId,
        folderName: folderName || "",
      },
    });

    console.log(`Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        chunkIndex,
        totalChunks,
        sessionId,
        message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      }
    );
  } catch (error) {
    console.error("Error processing chunk upload:", error);
    return errorResponse(
      `Chunk upload error: ${error.message || "Unknown error"}`,
      500,
      origin
    );
  }
}

// Finalize chunked upload - combines all chunks into final file
async function handleFinalizeChunkedUpload(formData, env, origin) {
  try {
    const sessionId = formData.get("sessionId");
    const totalChunks = parseInt(formData.get("totalChunks"));
    const filename = formData.get("filename");
    const cloudflareId = formData.get("cloudflareId");
    const folderName = formData.get("folderName") || null;

    // Validate parameters
    if (!sessionId || isNaN(totalChunks) || !filename || !cloudflareId) {
      return errorResponse(
        "Missing required parameters for finalizing upload",
        400,
        origin
      );
    }

    // Validate Cloudflare ID format
    if (!isValidCloudflareId(cloudflareId, env.ALLOWED_CLOUDFLARE_ID)) {
      console.error("Invalid or unauthorized Cloudflare ID");
      return errorResponse(
        "Invalid or unauthorized Cloudflare ID",
        403,
        origin
      );
    }

    const prefix = `temp/${sessionId}/`;

    const listed = await env.BUCKET_NAME.list({ prefix });
    const chunksList = [];
    for (const object of listed.objects) {
      chunksList.push(object);
    }

    // Validate that we have all chunks
    if (chunksList.length !== totalChunks) {
      return errorResponse(
        `Missing chunks: expected ${totalChunks}, found ${chunksList.length}`,
        400,
        origin
      );
    }

    // Sort chunks by index
    chunksList.sort((a, b) => {
      const indexA = parseInt(a.key.split("/").pop());
      const indexB = parseInt(b.key.split("/").pop());
      return indexA - indexB;
    });

    // Create array for chunk data
    const chunksData = [];

    // Fetch all chunks
    for (const chunk of chunksList) {
      const chunkObj = await env.BUCKET_NAME.get(chunk.key);
      if (chunkObj === null) {
        return errorResponse(`Chunk not found: ${chunk.key}`, 404, origin);
      }

      const chunkData = await chunkObj.arrayBuffer();
      chunksData.push(new Uint8Array(chunkData));
    }

    // Combine chunks
    const totalSize = chunksData.reduce(
      (total, chunk) => total + chunk.length,
      0
    );
    const combinedArray = new Uint8Array(totalSize);

    let offset = 0;
    for (const chunk of chunksData) {
      combinedArray.set(chunk, offset);
      offset += chunk.length;
    }

    // Determine content type
    let contentType = "application/octet-stream";
    if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (filename.endsWith(".png")) {
      contentType = "image/png";
    } else if (filename.endsWith(".gif")) {
      contentType = "image/gif";
    } else if (filename.endsWith(".webp")) {
      contentType = "image/webp";
    }

    // Generate final storage path
    const storagePath = folderName ? `${folderName}/${filename}` : filename;

    try {
      if (IMAGE_COMPRESSION.enabled && contentType.startsWith('image/')) {
        // Compress and upload the combined image data (includes upload + overwrite)
        const compressedData = await compressImage(combinedArray, contentType, env, storagePath);
        console.log("Chunked file compression and upload completed");
      } else {
        // Direct upload without compression
        console.log("Starting direct chunked upload to R2...");
        await env.BUCKET_NAME.put(storagePath, combinedArray, {
          httpMetadata: { contentType: contentType },
        });
        console.log("Direct chunked upload completed");
      }

      // Generate public URL
      const publicUrl = env.R2_PUBLIC_DOMAIN
        ? `https://${env.R2_PUBLIC_DOMAIN}/${storagePath}`
        : null;

      console.log(`Chunked upload finalized successfully: ${storagePath}`);
    } catch (error) {
      console.error("Error in chunked upload finalization:", error);
      return errorResponse(
        `Finalization error: ${error.message || "Unknown error"}`,
        500,
        origin
      );
    }

    // Clean up temporary chunks (async)
    env.BUCKET_NAME.list({ prefix })
      .then((result) => {
        for (const object of result.objects) {
          env.BUCKET_NAME.delete(object.key).catch((error) => {
            console.error(
              `Error deleting temporary chunk ${object.key}:`,
              error
            );
          });
        }
        console.log(
          `Cleanup of ${result.objects.length} temporary chunks initiated`
        );
      })
      .catch((error) => {
        console.error("Error during cleanup:", error);
      });

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        url: publicUrl,
        path: storagePath,
        size: totalSize,
        type: contentType,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      }
    );
  } catch (error) {
    console.error("Error finalizing chunked upload:", error);
    return errorResponse(
      `Finalization error: ${error.message || "Unknown error"}`,
      500,
      origin
    );
  }
}

// Helper for error responses
function errorResponse(message, status = 400, origin = "*") {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
    }),
    {
      status: status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
      },
    }
  );
}
