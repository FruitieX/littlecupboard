import { useEffect, useState } from 'react'
import { LoaderCircle, Sparkles } from 'lucide-react'
import type { IconJobStatus } from '../lib/api/IconJobStatus'
import { api, post } from '../lib/http'
import { useApp } from '../lib/state'
import { Modal } from './ui'

export function IconGenerationSettings() {
  const { state, status } = useApp()
  const [jobs, setJobs] = useState<IconJobStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = () => {
      void api<IconJobStatus>('/ai/item-icons')
        .then((result) => {
          if (active) setJobs(result)
        })
        .catch((error) => {
          if (active) setError(error.message)
        })
    }
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [state.customProducts, state.productImages, state.archivedProductIds])
  async function run(action: 'generate' | 'retry' | 'cancel') {
    setBusy(true)
    setError('')
    try {
      await post('/ai/item-icons', { action })
      setConfirm(false)
      setJobs(await api<IconJobStatus>('/ai/item-icons'))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const pending = (jobs?.queued ?? 0) + (jobs?.running ?? 0)
  return (
    <div className="icon-generation-settings">
      <strong>Missing item icons</strong>
      <p className="settings-description">
        {jobs ? `${jobs.missing} items use the cart placeholder.` : 'Loading…'}{' '}
        Archived items and existing artwork are skipped. Icons match the flat
        catalog style with transparent backgrounds, saved at 256 px.
      </p>
      <div className="image-field-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={
            busy || !jobs?.ready || !jobs.missing || status === 'offline'
          }
          onClick={() => setConfirm(true)}
        >
          <Sparkles size={16} /> Generate missing icons
        </button>
        {!!jobs?.failed && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !jobs.ready || status === 'offline'}
            onClick={() => void run('retry')}
          >
            Retry failed icons
          </button>
        )}
        {pending > 0 && (
          <button
            type="button"
            className="text-button"
            disabled={busy || status === 'offline'}
            onClick={() => void run('cancel')}
          >
            Stop generation
          </button>
        )}
      </div>
      {pending > 0 && (
        <p role="status" className="settings-description">
          <LoaderCircle size={15} className="spin" />{' '}
          {jobs?.running ? 'Generating an icon.' : 'Waiting for the next icon.'}{' '}
          {jobs?.queued} queued · {jobs?.completed} generated · {jobs?.failed}{' '}
          failed.
        </p>
      )}
      <small>
        Uses the saved provider. One at a time, up to 20 background icons per
        hour; remaining items stay queued. You can close the app while it works.
        {!jobs?.ready && ' Enable the assistant and save an image model first.'}
      </small>
      {!!jobs?.failed && (
        <ul className="icon-generation-failures">
          {jobs.failures.map((failure) => (
            <li key={failure.productId}>
              <strong>{failure.name}:</strong> {failure.error}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Modal
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open)
        }}
        title="Generate missing item icons?"
        description={`Request an icon for each of the ${jobs?.missing ?? 0} items without artwork using your saved image provider. This uses provider quota and may incur charges. Existing images and emoji artwork are kept.`}
      >
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy || status === 'offline'}
            onClick={() => void run('generate')}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            Generate icons
          </button>
        </div>
      </Modal>
    </div>
  )
}
