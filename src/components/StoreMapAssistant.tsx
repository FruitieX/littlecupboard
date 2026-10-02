import { useState } from 'react'
import { ImagePlus, LoaderCircle, Sparkles } from 'lucide-react'
import { useApp } from '../lib/state'
import { post, uploadImage } from '../lib/http'
import type { StoreLayoutProposal } from '../lib/api/StoreLayoutProposal'

export function StoreMapAssistant({
  name,
  location,
  order,
  onApply,
  onBusyChange,
  disabled,
}: {
  name: string
  location: string
  order: string[]
  onApply: (order: string[]) => void
  onBusyChange: (busy: boolean) => void
  disabled: boolean
}) {
  const { session, status, groups } = useApp()
  const [image, setImage] = useState('')
  const [filename, setFilename] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<StoreLayoutProposal | null>(null)
  if (!session.aiEnabled) return null
  async function run(task: () => Promise<void>) {
    setBusy(true)
    onBusyChange(true)
    setError('')
    setProposal(null)
    try {
      await task()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }
  const unavailable = busy || disabled || status === 'offline'
  return (
    <fieldset className="store-map-assistant">
      <legend>Order aisles from a store map</legend>
      <p className="quiet-label">
        Upload a floor plan. Review the suggested route before saving your shop.
      </p>
      {image && (
        <figure>
          <img src={image} alt={`Store map: ${filename}`} />
          <figcaption>{filename}</figcaption>
        </figure>
      )}
      <div className="image-field-actions">
        <label className="secondary-button">
          <ImagePlus size={16} />
          {image ? 'Replace map' : 'Upload map'}
          <input
            aria-label="Upload store map"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={unavailable}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file)
                void run(async () => {
                  setImage(await uploadImage(file, true))
                  setFilename(file.name)
                })
              event.target.value = ''
            }}
          />
        </label>
      </div>
      {image && (
        <>
          <label>
            Route notes
            <textarea
              rows={2}
              maxLength={8000}
              value={notes}
              disabled={unavailable}
              onChange={(event) => {
                setNotes(event.target.value)
                setProposal(null)
              }}
              placeholder="e.g. Entrance at the bottom left; start with produce"
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={unavailable || !name.trim()}
            onClick={() =>
              void run(async () =>
                setProposal(
                  await post<StoreLayoutProposal>('/ai/store-layout', {
                    name: name.trim(),
                    location,
                    order,
                    images: [image],
                    prompt: notes,
                  }),
                ),
              )
            }
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {busy ? 'Reading map…' : 'Suggest aisle order'}
          </button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {proposal && (
        <section
          className="store-map-proposal"
          aria-label="Suggested aisle order"
        >
          <p>{proposal.message}</p>
          <ol>
            {proposal.order.map((group) => (
              <li key={group}>{group}</li>
            ))}
          </ol>
          {order.some((group) => !proposal.order.includes(group)) && (
            <details className="store-map-omissions">
              <summary>
                {
                  order.filter((group) => !proposal.order.includes(group))
                    .length
                }{' '}
                aisles omitted from this route
              </summary>
              <p className="quiet-label">
                {order
                  .filter((group) => !proposal.order.includes(group))
                  .join(', ')}
                . Their items stay visible at the end of the list.
              </p>
            </details>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setProposal(null)}
            >
              Discard suggestion
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (proposal.order.some((group) => !groups.includes(group))) {
                  setError('An item group changed. Request a new suggestion.')
                  setProposal(null)
                  return
                }
                onApply(proposal.order)
                setProposal(null)
              }}
            >
              Use this order
            </button>
          </div>
        </section>
      )}
      {busy && !image && (
        <p className="quiet-label" role="status">
          Uploading map…
        </p>
      )}
    </fieldset>
  )
}
