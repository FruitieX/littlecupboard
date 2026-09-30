import { useState } from 'react'
import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useApp } from '../lib/state'
import { post, uploadImage } from '../lib/http'

export function ImageField({
  value,
  onChange,
  subject,
  onBusyChange,
}: {
  value: string
  onChange: (value: string) => void
  subject: string
  onBusyChange?: (busy: boolean) => void
}) {
  const { session, status } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(task: () => Promise<string>) {
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    try {
      onChange(await task())
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }
  return (
    <fieldset className="image-field">
      <legend>
        Picture <span className="optional">optional</span>
      </legend>
      {value && (
        <img
          className="image-field-preview"
          src={value}
          alt={`Picture of ${subject || 'your recipe'}`}
        />
      )}
      <div className="image-field-actions">
        <label className="secondary-button">
          <ImagePlus size={16} /> Choose photo
          <input
            aria-label="Upload picture"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || status === 'offline'}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void run(() => uploadImage(file))
              event.target.value = ''
            }}
          />
        </label>
        {session.imageEnabled && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !subject.trim() || status === 'offline'}
            onClick={() =>
              void run(
                async () =>
                  (
                    await post<{ url: string }>('/ai/image', {
                      prompt: `A beautiful natural food photograph of ${subject}, softly lit, simple warm background, no lettering.`,
                    })
                  ).url,
              )
            }
          >
            <Sparkles size={16} /> Generate
          </button>
        )}
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label="Remove picture"
            disabled={busy}
            onClick={() => onChange('')}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <small>
        JPG, PNG or WebP, up to 8 MB. Photos are resized and stored privately
        for your household.
      </small>
      {busy && (
        <p role="status">
          <LoaderCircle className="spin" size={16} /> Preparing your picture…
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
