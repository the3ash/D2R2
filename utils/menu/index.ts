import { getConfig } from "../storage";
import { handleError } from "../helpers";

// Constants definition
export const PARENT_MENU_ID = "d2r2-parent";
export const ROOT_FOLDER_ID = "bucket-root";
export const FOLDER_PREFIX = "folder-";

/**
 * Parse folder path string
 */
export function parseFolderPath(folderPath: string | undefined): string[] {
  if (!folderPath || folderPath.trim() === "") {
    return [];
  }

  // Support both half-width comma(,) and full-width comma(，) as separators
  return folderPath
    .replace(/，/g, ",") // First convert full-width comma to half-width comma
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path !== "");
}

/**
 * Safely create menu item
 */
async function safeCreateMenuItem(
  properties: chrome.contextMenus.CreateProperties
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.contextMenus.create(properties, () => {
        if (chrome.runtime.lastError) {
          console.error(
            `Failed to create menu item ${properties.id}:`,
            JSON.stringify(chrome.runtime.lastError)
          );
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (e) {
      console.error(`Exception creating menu item ${properties.id}:`, e);
      resolve(false);
    }
  });
}

/**
 * Create or update right-click menu
 */
export async function updateContextMenu(retryCount = 0): Promise<boolean> {
  try {
    console.log(`Updating context menu (retry=${retryCount})...`);

    // First clear existing menu
    await chrome.contextMenus.removeAll();
    console.log("Existing menu items cleared");

    // Add a small delay to ensure menu clearing is complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Get current configuration
    const config = await getConfig();

    // Log config details (redacted for security)
    console.log("Context menu configuration:", {
      folderCount: !!config.folderPath
        ? parseFolderPath(config.folderPath).length
        : 0,
      hideRoot: config.hideRoot,
      hasCloudflareId: !!config.cloudflareId,
      hasWorkerUrl: !!config.workerUrl,
    });

    const folders = parseFolderPath(config.folderPath);

    // Add safety delay to ensure previous menu operations are completed
    if (retryCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Based on folder path count and hideRoot setting, decide menu structure
    if (!folders || folders.length === 0) {
      // Case 1: No folder path, create single menu item
      await safeCreateMenuItem({
        id: ROOT_FOLDER_ID,
        title: "Drop to R2",
        contexts: ["image"],
      });
    } else if (folders.length === 1 && config.hideRoot) {
      // Case 2: Single folder path with hideRoot enabled
      const folderName = folders[0];
      await safeCreateMenuItem({
        id: `${FOLDER_PREFIX}0`,
        title: `Drop to R2 / ${folderName}`.replace(/\s*\/\s*/g, " / "),
        contexts: ["image"],
      });
    } else {
      // Case 3: Multiple folder paths or hideRoot disabled
      // Create parent menu
      const parentCreated = await safeCreateMenuItem({
        id: PARENT_MENU_ID,
        title: "Drop to R2",
        contexts: ["image"],
      });

      if (!parentCreated) {
        console.log("Failed to create parent menu, aborting submenu creation");
        return false;
      }

      console.log("Parent menu created successfully");

      // Add "Upload to root directory" option if not hidden
      if (!config.hideRoot) {
        await safeCreateMenuItem({
          id: ROOT_FOLDER_ID,
          parentId: PARENT_MENU_ID,
          title: "root" + " ".repeat(16),
          contexts: ["image"],
        });
      }

      // Create submenus for each folder
      for (const [index, folder] of folders.entries()) {
        await safeCreateMenuItem({
          id: `${FOLDER_PREFIX}${index}`,
          parentId: PARENT_MENU_ID,
          title: ` / ${folder}`.replace(/\s*\/\s*/g, " / "),
          contexts: ["image"],
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // Log result
    console.log("Context menu update completed successfully");
    return true;
  } catch (error) {
    handleError(error, "updateContextMenu", {
      retryable: retryCount < 3,
      retryContext: {
        retryCount,
        maxRetries: 3,
        retryInterval: 800,
        retryCallback: () => updateContextMenu(retryCount + 1),
      },
    });

    return false;
  }
}
