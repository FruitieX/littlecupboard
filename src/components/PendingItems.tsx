import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Camera, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { isJobActive } from '../lib/ai-jobs'
import type { AiJobView } from '../lib/ai-jobs'
import { settlePhotoJob, usePhotoJobs } from '../lib/photo-jobs'
import { useApp } from '../lib/state'
import { photoError } from './PhotoCapture'

const modeHint: Record<string, string> = {
  bought: 'Mark bought',
  pantry: 'Add to cupboard',
}

/**
 * Snapped or typed items the AI is still filling in, or could not add, sit
 * in the list itself so nothing is forgotten: a failed one keeps its photo
 * and waits for Retry or Dismiss on every device.
 */
export function PendingItems() {
  const { session, status } = useApp()
  const jobs = usePhotoJobs(session.aiEnabled).filter(
    (job) => isJobActive(job) || job.status === 'failed',
  )
  const [error, setError] = useState('')
  async function settle(job: AiJobView, action: 'retry' | 'dismiss') {
    setError('')
    try {
      await settlePhotoJob(job.id, action)
    } catch (error) {
      setError(photoError(error))
    }
  }
  return (
    <AnimatePresence initial={false}>
      {jobs.length > 0 && (
        <motion.section
          className="pending-items"
          aria-label="Items waiting to be added"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <ul>
            <AnimatePresence initial={false}>
              {jobs.map((job) => {
                const failed = job.status === 'failed'
                const name = job.name || 'Photographed item'
                return (
                  <motion.li
                    key={job.id}
                    className={failed ? 'failed' : undefined}
                    layout="position"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.18 }}
                  >
                    <span className="pending-item-photo" aria-hidden="true">
                      {job.photo ? (
                        <img src={job.photo} alt="" loading="lazy" />
                      ) : (
                        <Camera size={18} />
                      )}
                    </span>
                    <span className="pending-item-text">
                      <strong>{name}</strong>
                      <small>
                        {failed
                          ? job.error || 'The item could not be added.'
                          : 'Adding…'}
                        {job.mode && modeHint[job.mode]
                          ? ` · ${modeHint[job.mode]}`
                          : ''}
                      </small>
                    </span>
                    {failed ? (
                      <>
                        <button
                          type="button"
                          className="pending-item-action"
                          aria-label={`Retry ${name}`}
                          title="Retry"
                          disabled={status === 'offline'}
                          onClick={() => void settle(job, 'retry')}
                        >
                          <RotateCcw size={17} />
                        </button>
                        <button
                          type="button"
                          className="pending-item-action"
                          aria-label={`Dismiss ${name}`}
                          title="Dismiss"
                          disabled={status === 'offline'}
                          onClick={() => void settle(job, 'dismiss')}
                        >
                          <X size={17} />
                        </button>
                      </>
                    ) : (
                      <LoaderCircle
                        size={17}
                        className="spin pending-item-spinner"
                        aria-label="Adding"
                      />
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  )
}
