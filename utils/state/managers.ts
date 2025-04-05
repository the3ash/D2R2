import { ExtensionState, UploadState } from "./types";

// State manager for extension
export class ExtensionStateManager {
  private state: ExtensionState = ExtensionState.UNINITIALIZED;
  private lastInitTime: number = 0;
  private initializationAttempts: number = 0;
  private isInitializing: boolean = false;

  readonly MAX_INIT_ATTEMPTS: number = 10;
  readonly MIN_INIT_INTERVAL: number = 500; // ms
  readonly INIT_CHECK_INTERVAL: number = 300; // ms

  constructor() {}

  public getState(): ExtensionState {
    return this.state;
  }

  public isReady(): boolean {
    return this.state === ExtensionState.READY;
  }

  public startInitialization(source: string): boolean {
    // Prevent multiple initializations
    if (this.isInitializing) {
      console.log(
        `${source}: Another initialization is in progress, waiting...`
      );
      return false;
    }

    // Check initialization interval
    const now = Date.now();
    if (now - this.lastInitTime < this.MIN_INIT_INTERVAL) {
      console.log(
        `${source}: Last initialization was ${
          now - this.lastInitTime
        }ms ago, too recent`
      );
      return false;
    }

    // Proceed with initialization
    this.state = ExtensionState.INITIALIZING;
    this.isInitializing = true;
    this.lastInitTime = now;
    this.initializationAttempts++;
    console.log(
      `${source}: Beginning initialization... (attempt ${this.initializationAttempts})`
    );

    return true;
  }

  public completeInitialization(success: boolean) {
    this.isInitializing = false;

    if (success) {
      this.state = ExtensionState.READY;
      console.log("Extension initialization completed successfully");
    } else {
      this.state = ExtensionState.ERROR;
      console.error("Extension initialization failed");
    }
  }

  public resetState() {
    this.state = ExtensionState.UNINITIALIZED;
    this.isInitializing = false;
  }

  public hasReachedMaxAttempts(): boolean {
    return this.initializationAttempts >= this.MAX_INIT_ATTEMPTS;
  }
}

// Manager for upload tasks
export class UploadTaskManager {
  private tasks: Map<
    string,
    {
      state: UploadState;
      info: chrome.contextMenus.OnClickData;
      tab?: chrome.tabs.Tab;
      targetFolder: string | null;
      startTime: number;
      retryCount: number;
      errorMessage?: string;
    }
  > = new Map();

  readonly MAX_RETRY_COUNT: number = 3;
  readonly RETRY_INTERVAL: number = 500; // ms
  readonly MENU_CLICK_COOLDOWN: number = 300; // ms

  private lastMenuClickTime: number = 0;

  constructor() {}

  public createTask(
    info: chrome.contextMenus.OnClickData,
    tabOrFolder?: chrome.tabs.Tab | string | null
  ): string {
    // Generate a unique task ID
    const taskId = `upload_${Date.now()}`;

    // Determine if the second parameter is a tab or a folder
    let tab: chrome.tabs.Tab | undefined;
    let targetFolder: string | null = null;

    if (tabOrFolder === null) {
      // This is explicitly a null folder
      targetFolder = null;
    } else if (typeof tabOrFolder === "string") {
      // This is a folder string
      targetFolder = tabOrFolder;
    } else if (tabOrFolder && typeof tabOrFolder === "object") {
      // This is a tab object
      tab = tabOrFolder;
    }

    this.tasks.set(taskId, {
      state: UploadState.PENDING,
      info,
      tab,
      targetFolder,
      startTime: Date.now(),
      retryCount: 0,
    });

    console.log(
      `[UploadTask] Created task ${taskId} with state ${UploadState.PENDING}`
    );
    return taskId;
  }

  public updateTaskState(
    taskId: string,
    state: UploadState,
    errorMsg?: string
  ) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.state = state;
      if (errorMsg) task.errorMessage = errorMsg;
      console.log(`[UploadTask][${taskId}] State updated to: ${state}`);
    }
  }

  public setTaskFolder(taskId: string, folder: string | null) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.targetFolder = folder;
    }
  }

  public getTaskState(taskId: string): UploadState | null {
    return this.tasks.get(taskId)?.state || null;
  }

  public getTask(taskId: string) {
    return this.tasks.get(taskId);
  }

  public canProcessMenuClick(): boolean {
    const now = Date.now();
    if (now - this.lastMenuClickTime < this.MENU_CLICK_COOLDOWN) {
      console.log("Menu click ignored - in cooldown period");
      return false;
    }
    this.lastMenuClickTime = now;
    return true;
  }

  public updateMenuClickTime() {
    this.lastMenuClickTime = Date.now();
  }

  public getLastMenuClickTime(): number {
    return this.lastMenuClickTime;
  }

  public shouldRetry(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    return task.retryCount < this.MAX_RETRY_COUNT;
  }

  public incrementRetryCount(taskId: string): number {
    const task = this.tasks.get(taskId);
    if (!task) return 0;

    task.retryCount++;
    return task.retryCount;
  }

  public getRetryState(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    return {
      retryCount: task.retryCount,
      maxRetries: this.MAX_RETRY_COUNT,
      shouldRetry: task.retryCount < this.MAX_RETRY_COUNT,
    };
  }

  public cleanupTask(taskId: string) {
    this.tasks.delete(taskId);
  }
}

// PageStateManager for tracking page/tab state
export class PageStateManager {
  private activeTabId: number | null = null;
  private lastActiveUrl: string | null = null;
  private pendingMenuClicks: Array<{
    info: chrome.contextMenus.OnClickData;
    tab?: chrome.tabs.Tab;
    timestamp: number;
  }> = [];

  constructor() {}

  public setActiveTab(tabId: number | null, url?: string | null) {
    this.activeTabId = tabId;
    if (url) this.lastActiveUrl = url;
  }

  public getActiveTab(): number | null {
    return this.activeTabId;
  }

  public getActiveUrl(): string | null {
    return this.lastActiveUrl;
  }

  public addPendingMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ) {
    this.pendingMenuClicks.push({
      info,
      tab,
      timestamp: Date.now(),
    });
    console.log(
      `Added pending menu click, total: ${this.pendingMenuClicks.length}`
    );
  }

  public getNextPendingMenuClick() {
    return this.pendingMenuClicks.shift();
  }

  public hasPendingMenuClicks(): boolean {
    return this.pendingMenuClicks.length > 0;
  }

  public getPendingClicksCount(): number {
    return this.pendingMenuClicks.length;
  }
}
