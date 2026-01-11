import React from 'react';
import type { AppConfig } from '../../../utils/storage';
import { Dropdown } from './Dropdown';
import { SpinnerIcon } from './SpinnerIcon';

type Props = {
  config: AppConfig | null;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig | null>>;
  isSaving: boolean;
  error: string | null;
  isFormSubmittable: boolean;
  onSubmit: (e: React.FormEvent) => void | Promise<void>;
};

const QUALITY_OPTIONS = [
  { label: 'Original', value: '0' },
  { label: 'High', value: '0.8' },
  { label: 'Medium', value: '0.6' },
  { label: 'Low', value: '0.4' },
];

export function SettingsForm({
  config,
  setConfig,
  isSaving,
  error,
  isFormSubmittable,
  onSubmit,
}: Props) {
  const qualityValue = String(config?.imageQuality ?? 0);

  return (
    <form onSubmit={onSubmit} autoComplete='off'>
      <div className='form-group'>
        <label className='font-caption'>Cloudflare ID</label>
        <input
          id='cloudflare-id'
          type='text'
          className='font-body'
          value={config?.cloudflareId || ''}
          onChange={(e) =>
            setConfig((prev) =>
              prev ? { ...prev, cloudflareId: e.target.value } : null
            )
          }
          placeholder='Your Cloudflare Account ID'
          disabled={isSaving}
          autoComplete='off'
          spellCheck={false}
        />
      </div>

      <div className='form-group'>
        <label className='font-caption'>Worker URL</label>
        <input
          id='worker-url'
          type='text'
          className='font-body'
          value={config?.workerUrl || ''}
          onChange={(e) =>
            setConfig((prev) =>
              prev ? { ...prev, workerUrl: e.target.value } : null
            )
          }
          placeholder='your-worker.subdomain.workers.dev'
          disabled={isSaving}
          autoComplete='off'
          spellCheck={false}
        />
      </div>

      <div className='form-group'>
        <label className='font-caption'>Storage Path (Optional)</label>
        <div className='storage-path-container'>
          <input
            id='folder-path'
            type='text'
            className='font-body'
            value={config?.folderPath || ''}
            onChange={(e) =>
              setConfig((prev) =>
                prev ? { ...prev, folderPath: e.target.value } : null
              )
            }
            placeholder='folder, folder/subfolder'
            disabled={isSaving}
            autoComplete='off'
            spellCheck={false}
          />
          {config?.folderPath && (
            <div className='hide-root-option'>
              <label className='checkbox-label font-caption'>
                <input
                  type='checkbox'
                  checked={config?.hideRoot || false}
                  onChange={(e) =>
                    setConfig((prev) =>
                      prev ? { ...prev, hideRoot: e.target.checked } : null
                    )
                  }
                  disabled={isSaving}
                />
                <span className='font-caption'>Hide Root</span>
              </label>
            </div>
          )}
        </div>
        <div className='input-help'>
          Multiple paths allowed, separated by commas.
        </div>
      </div>

      <div className='form-group'>
        <label className='font-caption'>Image Quality</label>
        <Dropdown
          id='image-quality'
          value={qualityValue}
          options={QUALITY_OPTIONS}
          menuPlacement='up'
          disabled={isSaving}
          onChange={(v) => {
            const parsed = Number.parseFloat(v);
            setConfig((prev) =>
              prev
                ? {
                    ...prev,
                    imageQuality: Number.isFinite(parsed) ? parsed : 0,
                  }
                : null
            );
          }}
        />
        {qualityValue !== '0' && (
          <div className='input-help'>PNG may not compress much.</div>
        )}
      </div>

      <div className='save-btn-container'>
        {error && <div className='error-message-text'>{error}</div>}
        <button
          type='submit'
          className='save-btn font-body-m'
          disabled={isSaving || !isFormSubmittable}
          style={{
            opacity: isFormSubmittable ? 1 : 0.24,
            cursor: isFormSubmittable ? 'pointer' : 'not-allowed',
          }}
        >
          {isSaving ? <SpinnerIcon className='loading-icon' /> : 'Save'}
        </button>
      </div>
    </form>
  );
}
