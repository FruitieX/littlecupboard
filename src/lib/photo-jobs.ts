import { useEffect, useSyncExternalStore } from 'react'
import { fetchAiJobs, isJobActive } from './ai-jobs'
import type { AiJobView } from './ai-jobs'
import { post } from './http'
import type { AiJobAction } from './api/AiJobAction'
import type { AiJobCreated } from './api/AiJobCreated'

/** Fired after this device queues a photo or typed item job. */
export const photoJobQueuedEvent = 'littlecupboard:photo-job-queued'
/** Fired on every household notice, which includes photo job changes. */
export const householdSyncEvent = 'littlecupboard:sync'

/**
 * One shared view of the household's background item jobs, so the camera
 * button and the shopping list agree and poll only once. Failed jobs stay
 * listed by the server until someone retries or dismisses them.
 */
let jobs: AiJobView[] = []
const listeners = new Set<() => void>()
let timer: number | undefined
let users = 0
let inflight = false
let again = false

function publish(next: AiJobView[]) {
  jobs = next
  listeners.forEach((listener) => listener())
  if (timer !== undefined) window.clearInterval(timer)
  timer = undefined
  if (users > 0 && next.some(isJobActive))
    timer = window.setInterval(() => void refreshPhotoJobs(), 4000)
}

export async function refreshPhotoJobs() {
  if (inflight) {
    again = true
    return
  }
  inflight = true
  try {
    publish(await fetchAiJobs({ scope: 'photo' }))
  } catch {
    /* Status is best effort; the work continues on the server. */
  } finally {
    inflight = false
    if (again) {
      again = false
      void refreshPhotoJobs()
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePhotoJobs(enabled: boolean): AiJobView[] {
  useEffect(() => {
    if (!enabled) return
    users += 1
    const refresh = () => void refreshPhotoJobs()
    refresh()
    window.addEventListener(photoJobQueuedEvent, refresh)
    window.addEventListener(householdSyncEvent, refresh)
    return () => {
      users -= 1
      window.removeEventListener(photoJobQueuedEvent, refresh)
      window.removeEventListener(householdSyncEvent, refresh)
      if (!users && timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
  }, [enabled])
  const current = useSyncExternalStore(
    subscribe,
    () => jobs,
    () => jobs,
  )
  return enabled ? current : []
}

/** Queue a failed item again with the same photos and details, or give up. */
export async function settlePhotoJob(id: string, action: 'retry' | 'dismiss') {
  // Update at once so the tile reacts before the round trip finishes.
  publish(
    jobs
      .map((job) =>
        job.id === id
          ? { ...job, status: action === 'retry' ? 'queued' : 'canceled' }
          : job,
      )
      .filter((job) => job.status !== 'canceled'),
  )
  try {
    await post<AiJobCreated>(`/ai/jobs/${encodeURIComponent(id)}`, {
      action,
    } satisfies AiJobAction)
  } finally {
    void refreshPhotoJobs()
  }
}
