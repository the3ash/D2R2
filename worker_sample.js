/**
 * D2R2 Cloudflare Worker
 *
 * Required environment variables: ALLOWED_CLOUDFLARE_ID, R2_PUBLIC_DOMAIN
 */

// Constants
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

// Supported image formats with magic bytes
const IMAGE_SIGNATURES = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'image/bmp': [[0x42, 0x4d]],
}

// Validate Cloudflare ID format and authorization
function isValidCloudflareId(id, allowedId) {
  if (!id || typeof id !== 'string') return false
  const cloudflareIdRegex = /^[0-9a-f]{32}$/i
  return cloudflareIdRegex.test(id) && id === allowedId
}

// Validate image format using magic bytes
function validateImageFormat(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 12))

  for (const [mimeType, signatures] of Object.entries(IMAGE_SIGNATURES)) {
    for (const signature of signatures) {
      if (signature.every((byte, i) => bytes[i] === byte)) {
        // Additional check for WebP (RIFF....WEBP)
        if (mimeType === 'image/webp') {
          const webpMarker = [0x57, 0x45, 0x42, 0x50] // "WEBP"
          if (!webpMarker.every((byte, i) => bytes[i + 8] === byte)) {
            continue
          }
        }
        return { valid: true, detectedType: mimeType }
      }
    }
  }

  return { valid: false, detectedType: null }
}

// Generate public URL
function generatePublicUrl(env, storagePath) {
  if (!env.R2_PUBLIC_DOMAIN) {
    console.warn('R2_PUBLIC_DOMAIN not configured')
    return null
  }
  return `https://${env.R2_PUBLIC_DOMAIN}/${storagePath}`
}

// Helper for error responses
function errorResponse(message, status = 400, origin = '*') {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
      },
    }
  )
}

// Handle CORS preflight requests
function handleCorsRequest(request) {
  const origin = request.headers.get('Origin') || '*'
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}

// Handle test connection requests
async function handleTestConnectionRequest(request, env) {
  const origin = request.headers.get('Origin') || '*'

  try {
    const url = new URL(request.url)
    const cloudflareId = url.searchParams.get('cloudflareId')
    const isValidId = cloudflareId
      ? isValidCloudflareId(cloudflareId, env.ALLOWED_CLOUDFLARE_ID)
      : false

    const responseData = {
      success: true,
      message: 'D2R2 Worker connection normal',
      timestamp: new Date().toISOString(),
      workerInfo: {
        r2Status: env.BUCKET_NAME ? 'Available' : 'Unavailable',
        region: request.cf?.colo || 'Unknown',
        idValidation: {
          provided: !!cloudflareId,
          valid: isValidId,
        },
      },
      version: '2.0.0',
    }

    return new Response(JSON.stringify(responseData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Test connection error:', error)
    return errorResponse(error.message || 'Test connection failed', 500, origin)
  }
}

// Handle file upload requests
async function handleFileRequest(request, env) {
  const origin = request.headers.get('Origin') || '*'

  try {
    // Check Content-Length before parsing
    const contentLength = parseInt(request.headers.get('Content-Length') || '0')
    if (contentLength > MAX_FILE_SIZE) {
      return errorResponse(
        `File too large. Maximum size is 20MB, received ${Math.round(contentLength / 1024 / 1024)}MB`,
        413,
        origin
      )
    }

    // Parse FormData
    const formData = await request.formData()
    const file = formData.get('file')
    const cloudflareId = formData.get('cloudflareId')
    const folderName = formData.get('folderName') || null

    // Validate required parameters
    if (!file || !cloudflareId) {
      return errorResponse('Missing required file or cloudflareId', 400, origin)
    }

    // Validate Cloudflare ID
    if (!isValidCloudflareId(cloudflareId, env.ALLOWED_CLOUDFLARE_ID)) {
      return errorResponse('Invalid or unauthorized Cloudflare ID', 403, origin)
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse(
        `File too large. Maximum size is 20MB, received ${Math.round(file.size / 1024 / 1024)}MB`,
        413,
        origin
      )
    }

    // Validate image format using magic bytes
    const fileBuffer = await file.arrayBuffer()
    const formatValidation = validateImageFormat(fileBuffer)

    if (!formatValidation.valid) {
      return errorResponse(
        'Invalid file format. Only JPEG, PNG, GIF, WebP, and BMP images are allowed',
        415,
        origin
      )
    }

    // Generate storage path
    const fileName = file.name
    const storagePath = folderName ? `${folderName}/${fileName}` : fileName

    console.log(`Uploading: ${storagePath} (${file.size} bytes, ${formatValidation.detectedType})`)

    // Upload to R2
    await env.BUCKET_NAME.put(storagePath, fileBuffer, {
      httpMetadata: {
        contentType: formatValidation.detectedType || file.type,
      },
    })

    // Generate public URL
    const publicUrl = generatePublicUrl(env, storagePath)

    console.log(`Upload successful: ${storagePath}`)

    return new Response(
      JSON.stringify({
        success: true,
        url: publicUrl,
        path: storagePath,
        size: file.size,
        type: formatValidation.detectedType,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin,
        },
      }
    )
  } catch (error) {
    console.error('File upload error:', error)
    return errorResponse(`Upload error: ${error.message || 'Unknown error'}`, 500, origin)
  }
}

// Main request handler
export default {
  async fetch(request, env) {
    // Check required environment variable
    if (!env.ALLOWED_CLOUDFLARE_ID) {
      console.error('ALLOWED_CLOUDFLARE_ID not configured')
      return errorResponse(
        'Server configuration error: Missing required security configuration',
        500,
        '*'
      )
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCorsRequest(request)
    }

    // Handle test connection
    if (request.method === 'GET') {
      return handleTestConnectionRequest(request, env)
    }

    // Handle file upload
    if (request.method === 'POST') {
      const contentType = request.headers.get('Content-Type') || ''

      if (contentType.includes('multipart/form-data')) {
        return handleFileRequest(request, env)
      }

      return errorResponse(
        'Unsupported content type. Use multipart/form-data for file uploads',
        415
      )
    }

    return errorResponse('Method not allowed', 405)
  },
}
