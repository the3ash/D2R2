// Types for our configuration
export interface BucketConfig {
  id: string;
  name: string;
  folders: string[];
}

export interface AppConfig {
  cloudflareId: string;
  workerUrl: string;
  folderPath: string;
  hideRoot: boolean;
  buckets: BucketConfig[];
}

// Default configuration
const defaultConfig: AppConfig = {
  cloudflareId: "",
  workerUrl: "",
  folderPath: "",
  hideRoot: false,
  buckets: [],
};

// Storage keys
const STORAGE_KEY = "d2r2_config";

// Helper function to handle storage errors
async function handleStorageError<T>(
  operation: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error("Storage operation failed:", error);
    return fallback;
  }
}

// Get configuration from storage
export async function getConfig(): Promise<AppConfig> {
  return handleStorageError(async () => {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return result[STORAGE_KEY] || defaultConfig;
  }, defaultConfig);
}

// Save configuration to storage
export async function saveConfig(config: AppConfig): Promise<void> {
  await handleStorageError(async () => {
    await chrome.storage.sync.set({ [STORAGE_KEY]: config });
  }, undefined);
}

// Add a new bucket to configuration
export async function addBucket(bucket: BucketConfig): Promise<AppConfig> {
  const config = await getConfig();
  config.buckets.push(bucket);
  await saveConfig(config);
  return config;
}

// Remove a bucket from configuration
export async function removeBucket(bucketId: string): Promise<AppConfig> {
  const config = await getConfig();
  config.buckets = config.buckets.filter((b) => b.id !== bucketId);
  await saveConfig(config);
  return config;
}

// Update a bucket in configuration
export async function updateBucket(
  bucketId: string,
  updatedBucket: BucketConfig
): Promise<AppConfig> {
  const config = await getConfig();
  const index = config.buckets.findIndex((b) => b.id === bucketId);
  if (index !== -1) {
    config.buckets[index] = updatedBucket;
    await saveConfig(config);
  }
  return config;
}
