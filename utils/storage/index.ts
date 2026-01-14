// Default configuration values
const DEFAULT_CONFIG: AppConfig = {
  cloudflareId: '',
  workerUrl: '',
  folderPath: '',
  hideRoot: false,
  imageQuality: 0,
  linkType: 'markdown',
  showNotifications: true,
  buckets: [],
}

export interface BucketConfig {
  id: string
  name: string
  folders: string[]
}

// Application configuration type
export interface AppConfig {
  cloudflareId: string
  workerUrl: string
  folderPath: string
  hideRoot: boolean
  imageQuality: number
  linkType: 'markdown' | 'html' | 'bbcode' | 'plain'
  showNotifications: boolean
  buckets: BucketConfig[]
}

// Storage keys
const STORAGE_KEYS = {
  CONFIG: 'd2r2_config',
}

// Configuration cache
class ConfigCache {
  private static instance: ConfigCache
  private cache: AppConfig | null = null
  private lastFetchTime: number = 0
  private readonly CACHE_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  private configListeners: ((config: AppConfig) => void)[] = []

  private constructor() {}

  public static getInstance(): ConfigCache {
    if (!ConfigCache.instance) {
      ConfigCache.instance = new ConfigCache()
    }
    return ConfigCache.instance
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    return this.cache !== null && Date.now() - this.lastFetchTime < this.CACHE_TIMEOUT
  }

  /**
   * Get configuration from cache or storage
   */
  public async getConfig(): Promise<AppConfig> {
    // Return from cache if valid
    if (this.isCacheValid()) {
      console.log('Using cached configuration')
      return this.cache!
    }

    // Otherwise fetch from storage
    console.log('Fetching configuration from storage')
    return new Promise<AppConfig>((resolve) => {
      chrome.storage.sync.get([STORAGE_KEYS.CONFIG], (result) => {
        const config = result[STORAGE_KEYS.CONFIG] as AppConfig
        const merged = {
          ...DEFAULT_CONFIG,
          ...config,
        }
        this.cache = {
          ...merged,
          imageQuality: Number.isFinite(merged.imageQuality)
            ? merged.imageQuality
            : DEFAULT_CONFIG.imageQuality,
          buckets: Array.isArray(merged.buckets) ? merged.buckets : DEFAULT_CONFIG.buckets,
        }
        this.lastFetchTime = Date.now()
        resolve(this.cache)
      })
    })
  }

  /**
   * Save configuration with updates
   */
  public async saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
    // Get current config first (either from cache or storage)
    const currentConfig = await this.getConfig()

    // Apply updates (incremental update)
    const updatedConfig = {
      ...currentConfig,
      ...config,
    }
    if (!Number.isFinite(updatedConfig.imageQuality)) {
      updatedConfig.imageQuality = DEFAULT_CONFIG.imageQuality
    }
    if (!Array.isArray(updatedConfig.buckets)) {
      updatedConfig.buckets = DEFAULT_CONFIG.buckets
    }

    // Save to storage
    return new Promise<AppConfig>((resolve, reject) => {
      chrome.storage.sync.set(
        {
          [STORAGE_KEYS.CONFIG]: updatedConfig,
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError)
          } else {
            // Update cache
            this.cache = updatedConfig
            this.lastFetchTime = Date.now()

            // Notify listeners
            this.notifyListeners(updatedConfig)

            resolve(updatedConfig)
          }
        }
      )
    })
  }

  /**
   * Invalidate the cache to force a refresh
   */
  public invalidateCache(): void {
    console.log('Invalidating configuration cache')
    this.cache = null
  }

  /**
   * Add a configuration change listener
   */
  public addConfigListener(listener: (config: AppConfig) => void): void {
    this.configListeners.push(listener)
  }

  /**
   * Remove a configuration change listener
   */
  public removeConfigListener(listener: (config: AppConfig) => void): void {
    const index = this.configListeners.indexOf(listener)
    if (index !== -1) {
      this.configListeners.splice(index, 1)
    }
  }

  /**
   * Notify all listeners about configuration changes
   */
  private notifyListeners(config: AppConfig): void {
    this.configListeners.forEach((listener) => {
      try {
        listener(config)
      } catch (error) {
        console.error('Error in config change listener:', error)
      }
    })
  }
}

// Initialize config cache listener for storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[STORAGE_KEYS.CONFIG]) {
    // Invalidate cache when config changes from another source
    ConfigCache.getInstance().invalidateCache()
  }
})

/**
 * Get application configuration
 */
export async function getConfig(): Promise<AppConfig> {
  return ConfigCache.getInstance().getConfig()
}

/**
 * Save application configuration
 */
export async function saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  return ConfigCache.getInstance().saveConfig(config)
}

/**
 * Add a configuration change listener
 */
export function addConfigChangeListener(listener: (config: AppConfig) => void): void {
  ConfigCache.getInstance().addConfigListener(listener)
}

/**
 * Remove a configuration change listener
 */
export function removeConfigChangeListener(listener: (config: AppConfig) => void): void {
  ConfigCache.getInstance().removeConfigListener(listener)
}

/**
 * Force refresh configuration
 */
export function refreshConfig(): Promise<AppConfig> {
  ConfigCache.getInstance().invalidateCache()
  return getConfig()
}
