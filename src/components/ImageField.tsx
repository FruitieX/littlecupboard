import { useEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useApp } from '../lib/state'
import { uploadImage } from '../lib/http'
import {
  createAiJob,
  fetchAiJobs,
  isJobActive,
  watchAiJob,
} from '../lib/ai-jobs'
import type { AiJobView } from '../lib/ai-jobs'

export function ImageField({
  value,
  onChange,
  subject,
  kind = 'recipe',
  scope = '',
  productId,
  onBusyChange,
  generateRequest,
  onGenerated,
}: {
  value: string
  onChange: (value: string) => void
  subject: string
  kind?: 'item' | 'recipe' | 'store'
  scope?: string
  productId?: string
  onBusyChange?: (busy: boolean) => void
  /** Starts a generation from outside, e.g. after AI fills in details. */
  generateRequest?: { key: number; subject: string } | null
  /** Saves a finished generation right away instead of waiting for Save. */
  onGenerated?: (url: string) => void
}) {
  const { session, status } = useApp()
  const [uploading, setUploading] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<AiJobView | null>(null)
  const [trouble, setTrouble] = useState(false)
  const [error, setError] = useState('')
  const [, setTick] = useState(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onGeneratedRef = useRef(onGenerated)
  onGeneratedRef.current = onGenerated
  const valueRef = useRef(value)
  valueRef.current = value
  const requestId = useRef<string | null>(null)
  const busyReported = useRef(false)
  const generating = jobId !== null
  useEffect(() => {
    // Only report changes; parents initialize their own idle state and some
    // count busy fields, so a mount-time call would decrement their counter.
    const busy = uploading || generating
    if (busyReported.current === busy) return
    busyReported.current = busy
    onBusyChange?.(busy)
  }, [uploading, generating])
  // Pick up a generation that finished (or is still running) while this dialog
  // was closed or the phone was asleep.
  useEffect(() => {
    if (!scope) return
    let active = true
    void fetchAiJobs({ scope })
      .then((jobs) => {
        if (!active) return
        const match = jobs.find(
          (job) =>
            job.kind === kind &&
            (job.productId ?? null) === (productId ?? null),
        )
        if (!match) return
        if (isJobActive(match)) {
          setTrouble(false)
          setJob(match)
          setJobId(match.id)
        } else if (match.status === 'done' && match.url && !valueRef.current) {
          onChangeRef.current(match.url)
        }
      })
      .catch(() => {
        /* Recovery is best effort; the button still works. */
      })
    return () => {
      active = false
    }
  }, [scope, kind, productId])
  useEffect(() => {
    if (!jobId) return
    return watchAiJob(
      jobId,
      (update) => {
        setJob(update)
        setTrouble(false)
        if (isJobActive(update)) return
        if (update.status === 'done' && update.url) {
          onChangeRef.current(update.url)
          onGeneratedRef.current?.(update.url)
        } else if (update.status === 'failed')
          setError(update.error || 'The picture could not be generated.')
        setJobId(null)
        setJob(null)
      },
      setTrouble,
    )
  }, [jobId])
  useEffect(() => {
    if (!generating) return
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(timer)
  }, [generating])
  async function runUpload(task: () => Promise<string>) {
    setUploading(true)
    setError('')
    try {
      onChange(await task())
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setUploading(false)
    }
  }
  const lastRequest = useRef(0)
  useEffect(() => {
    if (!generateRequest || generateRequest.key === lastRequest.current) return
    lastRequest.current = generateRequest.key
    if (!generating) void generate(generateRequest.subject)
  }, [generateRequest?.key])
  async function generate(prompt = subject) {
    setError('')
    setTrouble(false)
    setJob(null)
    // Reuse the id after a connection drop so a job that did reach the server
    // is collected instead of generated a second time.
    requestId.current = requestId.current ?? crypto.randomUUID()
    try {
      const created = await createAiJob({
        requestId: requestId.current,
        kind,
        scope,
        prompt:
          kind === 'store'
            ? `A grocery storefront for the shop named ${prompt}`
            : prompt,
        productId,
      })
      requestId.current = null
      setJobId(created.jobId)
    } catch (error) {
      setError(
        error instanceof TypeError
          ? 'Cannot reach the server. Check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'Please try again.',
      )
    }
  }
  const busy = uploading || generating
  const elapsed = job
    ? Math.max(0, Math.floor(Date.now() / 1000) - job.createdAt)
    : 0
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
          <ImagePlus size={16} /> Choose picture
          <input
            aria-label="Upload picture"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || status === 'offline'}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void runUpload(() => uploadImage(file))
              event.target.value = ''
            }}
          />
        </label>
        {session.imageEnabled && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !subject.trim() || status === 'offline'}
            onClick={() => void generate()}
          >
            <Sparkles size={16} />{' '}
            {kind !== 'recipe' ? 'Generate icon' : 'Generate photo'}
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
        JPG, PNG or WebP, up to 8 MB.{' '}
        {kind !== 'recipe'
          ? 'Generated icons match our flat artwork and are saved at 256 px. Transparent backgrounds are preserved.'
          : 'Photos are resized and stored privately for your household.'}
      </small>
      {generating && (
        <p role="status">
          <LoaderCircle className="spin" size={16} />{' '}
          {job?.status === 'running'
            ? kind !== 'recipe'
              ? `Generating your icon… ${elapsed}s`
              : `Generating your photo… ${elapsed}s`
            : 'Waiting to start…'}
          {trouble ? ' Reconnecting…' : ''}
        </p>
      )}
      {generating && (
        <small>
          {scope
            ? 'You can close this or lock your phone — it keeps generating, and the image appears here when it is done.'
            : 'This usually takes about half a minute.'}
        </small>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
