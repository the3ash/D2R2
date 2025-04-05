import React, { useState, useEffect } from "react";
import { AppConfig, getConfig, saveConfig } from "../../utils/storage";
import "./style.css";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Load configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const data = await getConfig();
        setConfig(data);
        setError(null);

        if (data && data.workerUrl && data.cloudflareId) {
          setIsViewMode(true);
        }
      } catch (err) {
        setError("Failed to load configuration");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  // Save configuration and test connection
  const saveAndTestConnection = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!config) return;

    setIsSaving(true);
    setError(null);

    try {
      if (!config.workerUrl) {
        throw new Error("Connection failed, try again or change settings");
      }

      let workerUrl = config.workerUrl.trim();
      if (
        !workerUrl.startsWith("http://") &&
        !workerUrl.startsWith("https://")
      ) {
        workerUrl = `https://${workerUrl}`;
        setConfig((prev) => (prev ? { ...prev, workerUrl } : null));
      }

      // Test GET request with longer timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout

      try {
        // Test Worker connection
        const testResponse = await fetch(workerUrl, {
          method: "GET",
          headers: {
            Origin: location.origin,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!testResponse.ok) {
          // Try to get more information from the response
          let errorDetail = "";
          try {
            const responseText = await testResponse.text();
            errorDetail = responseText
              ? ` - ${responseText.substring(0, 100)}`
              : "";
          } catch (e) {
            console.error("Failed to read response body:", e);
          }

          throw new Error(
            `Connection failed, try again or change settings: ${testResponse.status} ${testResponse.statusText}${errorDetail}`
          );
        }

        // Test successful, show message
        const responseText = await testResponse.text();
        try {
          const responseJson = JSON.parse(responseText);
          console.log("Test successful, response:", responseJson);
        } catch (e) {
          console.log("Test successful, but response is not JSON format");
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("Connection failed, try again or change settings");
        }
        throw err;
      }

      // If connection test passes, save the configuration with corrected URL
      await saveConfig(config);
      // Switch to view mode
      setIsViewMode(true);
    } catch (err) {
      setError("Connection failed, try again or change settings");
      console.error(err);
      // Add timer for error message to automatically disappear
      setTimeout(() => setError(null), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  // Switch to edit mode
  const handleEdit = () => {
    setIsViewMode(false);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-title">D2R2</div>
        {isViewMode && (
          <button
            onClick={handleEdit}
            className="edit-btn font-body-m"
            disabled={isEditing}
            style={{
              opacity: isEditing ? 0.24 : 1,
              cursor: isEditing ? "not-allowed" : "pointer",
            }}
          >
            {isEditing ? (
              <svg
                className="loading-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle
                  className="spinner"
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  strokeWidth="1.35"
                  stroke="currentColor"
                  strokeDasharray="32"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              "Edit"
            )}
          </button>
        )}
      </div>

      {isViewMode ? (
        <div className="view-mode">
          <div className="form-group">
            <label className="font-caption">Cloudflare ID</label>
            <div className="value-display font-body">
              {config?.cloudflareId}
            </div>
          </div>

          <div className="form-group">
            <label className="font-caption">Worker URL</label>
            <div className="value-display font-body">{config?.workerUrl}</div>
          </div>

          <div className="success-message font-body">
            <span className="dot"></span>
            Settings are in effect. Right-click the image to upload it to the R2
            bucket.
          </div>
        </div>
      ) : (
        <form onSubmit={saveAndTestConnection} autoComplete="off">
          <div className="form-group">
            <label className="font-caption" htmlFor="cloudflare-id">
              Cloudflare ID:
            </label>
            <input
              id="cloudflare-id"
              type="text"
              className="font-body"
              value={config?.cloudflareId || ""}
              onChange={(e) =>
                setConfig((prev) =>
                  prev ? { ...prev, cloudflareId: e.target.value } : null
                )
              }
              placeholder="Your Cloudflare Account ID"
              disabled={isSaving}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="form-group">
            <label className="font-caption" htmlFor="worker-url">
              Worker URL:
            </label>
            <input
              id="worker-url"
              type="text"
              className="font-body"
              value={config?.workerUrl || ""}
              onChange={(e) =>
                setConfig((prev) =>
                  prev ? { ...prev, workerUrl: e.target.value } : null
                )
              }
              placeholder="your-worker.your-name.workers.dev"
              disabled={isSaving}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className="font-caption" htmlFor="folder-path">
              Storage Path (Optional):
            </label>
            <div className="storage-path-container">
              <input
                id="folder-path"
                type="text"
                className="font-body"
                value={config?.folderPath || ""}
                onChange={(e) =>
                  setConfig((prev) =>
                    prev ? { ...prev, folderPath: e.target.value } : null
                  )
                }
                placeholder="folder, folder/subfolder"
                disabled={isSaving}
                autoComplete="off"
                spellCheck={false}
              />
              {config?.folderPath && (
                <div className="hide-root-option">
                  <label className="checkbox-label font-caption">
                    <input
                      type="checkbox"
                      checked={config?.hideRoot || false}
                      onChange={(e) =>
                        setConfig((prev) =>
                          prev ? { ...prev, hideRoot: e.target.checked } : null
                        )
                      }
                      disabled={isSaving}
                    />
                    <span className="font-caption">Hide Root</span>
                  </label>
                </div>
              )}
            </div>
            <div className="input-help">
              Multiple paths allowed, separated by commas.
            </div>
          </div>

          <div className="save-btn-container">
            <button
              type="submit"
              className="save-btn font-body-m"
              disabled={isSaving}
              style={{
                opacity: isSaving ? 0.24 : 1,
                cursor: isSaving ? "not-allowed" : "pointer",
              }}
            >
              {isSaving ? (
                <svg
                  className="loading-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    className="spinner"
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    strokeWidth="1.35"
                    stroke="currentColor"
                    strokeDasharray="32"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                "Save Settings"
              )}
            </button>
            {error && <div className="error-message-text">{error}</div>}
          </div>
        </form>
      )}
    </div>
  );
}
