import React, { useEffect, useState } from "react";
import type { AppConfig } from "../../utils/storage";
import { getConfig, saveConfig } from "../../utils/storage";
import { testWorkerConnection } from "../../utils/cloudflare/test-worker-connection";
import { SettingsForm } from "./components/SettingsForm";
import { SettingsView } from "./components/SettingsView";
import { SpinnerIcon } from "./components/SpinnerIcon";
import "./style.css";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);

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

    try {
      let workerUrl = config.workerUrl.trim();
      if (
        !workerUrl.startsWith("http://") &&
        !workerUrl.startsWith("https://")
      ) {
        workerUrl = `https://${workerUrl}`;
        setConfig((prev) => (prev ? { ...prev, workerUrl } : null));
      }

      try {
        await testWorkerConnection(
          workerUrl,
          config.cloudflareId.trim(),
          location.origin
        );
      } catch (err) {
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
            {isSaving ? <SpinnerIcon className="loading-icon" /> : "Edit"}
          </button>
        )}
      </div>

      {isViewMode ? (
        <SettingsView config={config} />
      ) : (
        <SettingsForm
          config={config}
          setConfig={setConfig}
          isSaving={isSaving}
          error={error}
          isFormSubmittable={isFormSubmittable()}
          onSubmit={saveAndTestConnection}
        />
      )}
    </div>
  );
}
