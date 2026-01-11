import React from "react";
import type { AppConfig } from "../../../utils/storage";

type Props = {
  config: AppConfig | null;
};

export function SettingsView({ config }: Props) {
  return (
    <div className="view-mode">
      <div className="form-group">
        <label className="font-caption">Cloudflare ID</label>
        <div className="value-display font-body">{config?.cloudflareId}</div>
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
  );
}

