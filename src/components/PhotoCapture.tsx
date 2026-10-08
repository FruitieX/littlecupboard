import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Camera,
  Check,
  Image as ImageIcon,
  LoaderCircle,
  ShoppingBasket,
  X,
} from 'lucide-react'
import { uploadImage } from '../lib/http'
import { createAiJob, fetchAiJobs, isJobActive } from '../lib/ai-jobs'
import type { AiJobView } from '../lib/ai-jobs'
import { useApp } from '../lib/state'
import { Modal } from './ui'

export type PhotoMode = 'list' | 'bought' | 'pantry'
type Mode = PhotoMode

/** Uploads a photo privately and queues the background job for it. */
export async function queuePhotoJob(file: File, mode: PhotoMode) {
  const url = await uploadImage(file, true)
  await createAiJob({
    kind: 'photo',
    scope: 'photo',
    prompt: JSON.stringify({ photo: url, mode }),
  })
}

export function photoError(error: unknown) {
  return error instanceof TypeError
    ? 'Cannot reach the server. Check your connection and try again.'
    : error instanceof Error
      ? error.message
      : 'Please try again.'
}

/**
 * Fire-and-forget photo capture: snap an item and put the phone away. The
 * server recognizes it, reuses or creates the item and adds it to the list
 * or records it as bought, even if this page closes.
 */
export function PhotoCapture({
  onQueued,
}: {
  onQueued: (message: string) => void
}) {
  const { session, status } = useApp()
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState<Mode | null>(null)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState<AiJobView[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const refresh = useCallback(() => {
    fetchAiJobs({ scope: 'photo' })
      .then(setJobs)
      .catch(() => {
        /* Status is best effort; the work continues on the server. */
      })
  }, [])
  useEffect(() => {
    if (session.aiEnabled) refresh()
  }, [session.aiEnabled, refresh])
  const active = jobs.filter(isJobActive)
  useEffect(() => {
    if (!active.length) return
    const timer = window.setInterval(refresh, 4000)
    return () => window.clearInterval(timer)
  }, [active.length, refresh])
  if (!session.aiEnabled) return null
  const failed = jobs.filter(
    (job) => job.status === 'failed' && !dismissed.includes(job.id),
  )
  const recent = jobs.filter((job) => job.status === 'done').slice(0, 3)
  async function capture(mode: Mode, file: File) {
    setUploading(mode)
    setError('')
    try {
      await queuePhotoJob(file, mode)
      setOpen(false)
      onQueued(
        mode === 'bought'
          ? 'Got it — we’ll mark it bought in the background.'
          : 'Got it — we’ll add it to the list in the background.',
      )
      refresh()
    } catch (error) {
      setError(photoError(error))
    } finally {
      setUploading(null)
    }
  }
  const choice = (mode: Mode, label: string, hint: string) => (
    <div className={`photo-choice ${uploading ? 'busy' : ''}`}>
      <label className="photo-choice-main">
        {uploading === mode ? (
          <LoaderCircle size={22} className="spin" />
        ) : mode === 'bought' ? (
          <ShoppingBasket size={22} />
        ) : (
          <Camera size={22} />
        )}
        <span>
          <strong>{label}</strong>
          <small>{uploading === mode ? 'Uploading the photo…' : hint}</small>
        </span>
        <input
          aria-label={label}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={!!uploading || status === 'offline'}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void capture(mode, file)
            event.target.value = ''
          }}
        />
      </label>
      <label className="photo-choice-gallery" title="Choose from gallery">
        <ImageIcon size={18} />
        <span className="sr-only">{label} from gallery</span>
        <input
          aria-label={`${label} from gallery`}
          type="file"
          accept="image/*"
          disabled={!!uploading || status === 'offline'}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void capture(mode, file)
            event.target.value = ''
          }}
        />
      </label>
    </div>
  )
  return (
    <>
      <button
        type="button"
        className="add-photo"
        aria-label="Snap an item"
        title="Snap an item to add it or mark it bought"
        onClick={() => setOpen(true)}
      >
        <Camera size={20} />
      </button>
      {(active.length > 0 || failed.length > 0) &&
        typeof document !== 'undefined' &&
        document.getElementById('photo-status-slot') &&
        createPortal(
          <div className="photo-status" role="status">
            {active.length > 0 && (
              <button type="button" onClick={() => setOpen(true)}>
                <LoaderCircle size={14} className="spin" />
                {active.length === 1
                  ? 'Adding 1 photo…'
                  : `Adding ${active.length} photos…`}
              </button>
            )}
            {failed.length > 0 && (
              <button
                type="button"
                className="failed"
                onClick={() => setOpen(true)}
              >
                <X size={14} />
                {failed.length === 1
                  ? 'A photo couldn’t be added'
                  : `${failed.length} photos couldn’t be added`}
              </button>
            )}
          </div>,
          document.getElementById('photo-status-slot')!,
        )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Snap an item"
        description="Take a photo and put your phone away. We’ll recognize it and finish the rest."
        className="compact-modal"
      >
        <div className="photo-choices">
          {choice('list', 'Add to list', 'For something we need')}
          {choice(
            'bought',
            'I’m buying it now',
            'Not on the list, in the basket',
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {(active.length > 0 || failed.length > 0 || recent.length > 0) && (
          <ul className="photo-jobs">
            {active.map((job) => (
              <li key={job.id}>
                <LoaderCircle size={15} className="spin" /> Recognizing a photo…
              </li>
            ))}
            {failed.map((job) => (
              <li key={job.id} className="failed">
                <X size={15} />
                <span>{job.error || 'The photo could not be recognized.'}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setDismissed((ids) => [...ids, job.id])}
                >
                  Dismiss
                </button>
              </li>
            ))}
            {recent.map((job) => (
              <li key={job.id}>
                <Check size={15} /> {job.name ?? 'Item'} added
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}
