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
  imageQuality: number;
  buckets: BucketConfig[];
}

// Default configuration
const defaultConfig: AppConfig = {
  cloudflareId: '',
  workerUrl: '',
  folderPath: '',
  hideRoot: false,
  imageQuality: 0,
  buckets: [],
};

// Storage keys
const STORAGE_KEY = 'd2r2_config';

// Helper function to handle storage errors
async function handleStorageError<T>(
  operation: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error('Storage operation failed:', error);
    return fallback;
  }
}

// Get configuration from storage
export async function getConfig(): Promise<AppConfig> {
  function isAppConfig(x: any): x is AppConfig {
    return (
      x != null &&
      typeof x.cloudflareId === 'string' &&
      typeof x.workerUrl === 'string' &&
      typeof x.folderPath === 'string' &&
      typeof x.hideRoot === 'boolean' &&
      (x.imageQuality == null || typeof x.imageQuality === 'number') &&
      Array.isArray(x.buckets)
    );
  }

  return handleStorageError<AppConfig>(async () => {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    return isAppConfig(stored) ? { ...defaultConfig, ...stored } : defaultConfig;
  }, defaultConfig);
}

// Save configuration to storage
export async function saveConfig(config: AppConfig): Promise<void> {
  await handleStorageError<void>(async () => {
    await chrome.storage.sync.set({ [STORAGE_KEY]: config });
  }, undefined as unknown as void);
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
