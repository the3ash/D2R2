<img src="public/icon.png" width="28" height="28" alt="screenshot">

# D2R2

Drop images to Cloudflare R2

A Chrome extension for uploading images from web pages to Cloudflare R2 via right-click menu

![screenshot](public/screenshot.png)

## Installation

1. Clone this repository
2. Run `pnpm install`
3. Run `pnpm build`
4. Open Chrome and visit `chrome://extensions`
5. Enable "Developer mode"
6. Click "Load unpacked" and select the `.output/chrome-mv3` folder

## Worker Setup

This extension requires a Cloudflare Worker. See [worker_sample.js](./worker_sample.js) for the code.

### 1. Create R2 Bucket

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to "R2" → "Create bucket"
3. Note down the bucket name

### 2. Create Worker

1. Go to "Workers & Pages" → "Create application" → "Create Worker"
2. Name your Worker and deploy
3. In Worker Settings → Variables:

   **R2 Bucket Binding:**
   - Variable name: `BUCKET_NAME`
   - Select your R2 bucket

   **Environment Variables:**
   - `ALLOWED_CLOUDFLARE_ID`: Your Cloudflare Account ID (32-char hex, found in dashboard URL)
   - `R2_PUBLIC_DOMAIN`: Your R2 public domain (e.g., `pub-xxx.r2.dev`)

4. Go to Worker → "Quick edit" → paste the worker code → "Save and deploy"

### 3. Extension Configuration

1. Open the extension popup
2. Enter your Cloudflare Account ID
3. Enter Worker URL: `https://your-worker.your-username.workers.dev`
4. (Optional) Add folder paths for organized uploads
5. (Optional) Set image quality to compress images

## Security

- The Worker validates requests using your Cloudflare Account ID
- Never expose your Worker URL publicly if possible
- Uses R2 Binding (no API keys needed)

## License

MIT
