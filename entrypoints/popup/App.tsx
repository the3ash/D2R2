import React, { useState, useEffect } from "react";
import { AppConfig, getConfig, saveConfig } from "../../utils/storage";
import "./style.css";

// Form validation types
interface ValidationErrors {
  workerUrl?: string;
  cloudflareId?: string;
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>(
    {}
  );

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

  // Validate form fields
  const validateForm = (): ValidationErrors => {
    return {};
  };

  // Check if URL is valid
  const isValidUrl = (url: string): boolean => {
    return !!url;
  };

  // Check if Cloudflare ID is valid
  const isValidCloudflareId = (id: string): boolean => {
    return !!id;
  };

  // Check if form can be submitted
  const isFormSubmittable = (): boolean => {
    return !!(config?.workerUrl?.trim() && config?.cloudflareId?.trim());
  };

  // Save configuration and test connection
  const saveAndTestConnection = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!config) return;

    if (!config.workerUrl?.trim() || !config.cloudflareId?.trim()) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setValidationErrors({});

    try {
      let workerUrl = config.workerUrl.trim();
      if (
        !workerUrl.startsWith("http://") &&
        !workerUrl.startsWith("https://")
      ) {
        workerUrl = `https://${workerUrl}`;
        setConfig((prev) => (prev ? { ...prev, workerUrl } : null));
      }

      // Add Cloudflare ID as query parameter
      const urlObj = new URL(workerUrl);
      urlObj.searchParams.append("cloudflareId", config.cloudflareId.trim());
      const testUrl = urlObj.toString();

      // Test GET request with longer timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const testResponse = await fetch(testUrl, {
          method: "GET",
          headers: {
            Origin: location.origin,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!testResponse.ok) {
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
            `Connection failed: ${testResponse.status} ${testResponse.statusText}${errorDetail}`
          );
        }

        const responseText = await testResponse.text();
        try {
          const responseJson = JSON.parse(responseText);
          console.log("Test successful, response:", responseJson);

          // Check ID validation result, but use generic error message
          if (responseJson.workerInfo?.idValidation) {
            const idValidation = responseJson.workerInfo.idValidation;
            if (!idValidation.valid) {
              throw new Error(
                "Connection failed, try again or change settings"
              );
            }
          }
        } catch (e) {
          console.log("Test response processing error:", e);
          if (e instanceof Error) {
            throw e;
          } else {
            console.log("Test successful, but response is not JSON format");
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("Connection timeout, try again");
        }
        throw err;
      }

      await saveConfig(config);
      setIsViewMode(true);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "AbortError"
          ? "Connection timeout, try again"
          : "Connection failed, try again or change settings"
      );
      console.error(err);
      setTimeout(() => setError(null), 3000);
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
            Settings are in effect. Right-click the image to drop it to the R2
            bucket.
          </div>
        </div>
      ) : (
        <form onSubmit={saveAndTestConnection} autoComplete="off">
          <div className="form-group">
            <label className="font-caption" htmlFor="cloudflare-id">
              Cloudflare ID
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
              Worker URL
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
              Storage Path (Optional)
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
            {error && <div className="error-message-text">{error}</div>}
            <button
              type="submit"
              className="save-btn font-body-m"
              disabled={isSaving || !isFormSubmittable()}
              style={{
                opacity: isFormSubmittable() ? 1 : 0.24,
                cursor: isFormSubmittable() ? "pointer" : "not-allowed",
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
                "Save"
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
