import { api, post } from './http'
import type { AiJobCreated } from './api/AiJobCreated'
import type { AiJobRequest } from './api/AiJobRequest'
import type { AiJobView } from './api/AiJobView'
import type { AiJobs } from './api/AiJobs'

export type { AiJobView }

export function isJobActive(job: AiJobView) {
  return job.status === 'queued' || job.status === 'running'
}

export function createAiJob(input: {
  kind: 'item' | 'recipe' | 'store' | 'sheet' | 'photo'
  scope?: string
  prompt?: string
  proposalId?: string
  recipeId?: string
  productId?: string
  items?: { id: string; name: string; category: string }[]
  requestId?: string
}): Promise<AiJobCreated> {
  return post<AiJobCreated>('/ai/jobs', {
    requestId: input.requestId ?? crypto.randomUUID(),
    scope: input.scope ?? '',
    kind: input.kind,
    prompt: input.prompt ?? '',
    proposalId: input.proposalId ?? null,
    recipeId: input.recipeId ?? null,
    productId: input.productId ?? null,
    items: input.items ?? null,
  } satisfies AiJobRequest)
}

export async function fetchAiJobs(query: {
  id?: string
  scope?: string
  proposal?: string
}): Promise<AiJobView[]> {
  const params = new URLSearchParams()
  if (query.id) params.set('id', query.id)
  if (query.scope) params.set('scope', query.scope)
  if (query.proposal) params.set('proposal', query.proposal)
  return (await api<AiJobs>(`/ai/jobs?${params.toString()}`)).jobs
}

export type StopWatching = () => void
/**
 * Follow one server-side generation until it finishes. Keeps retrying while
 * the phone sleeps, the connection changes or the server is briefly busy, so
 * a dropped fetch never surfaces as a failure.
 */
export function watchAiJob(
  id: string,
  onUpdate: (job: AiJobView) => void,
  onTrouble?: (trouble: boolean) => void,
): StopWatching {
  let stopped = false
  let timer: number | undefined
  let failures = 0
  const clear = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }
  const schedule = (delay: number) => {
    if (stopped) return
    clear()
    timer = window.setTimeout(() => void poll(), delay)
  }
  async function poll() {
    if (stopped) return
    // Hidden pages pause their timers on mobile; resume on visibilitychange.
    if (document.hidden) return
    try {
      const [job] = await fetchAiJobs({ id })
      if (stopped) return
      failures = 0
      onTrouble?.(false)
      if (job) onUpdate(job)
      if (job && !isJobActive(job)) return
      schedule(1500)
    } catch {
      if (stopped) return
      failures += 1
      onTrouble?.(true)
      schedule(Math.min(10000, 1500 * 2 ** Math.min(failures, 3)))
    }
  }
  const resume = () => {
    if (!document.hidden) void poll()
  }
  void poll()
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('online', resume)
  return () => {
    stopped = true
    clear()
    document.removeEventListener('visibilitychange', resume)
    window.removeEventListener('online', resume)
  }
}

/** Resolve when the job reaches a terminal state (done, failed or canceled). */
export function awaitAiJob(
  id: string,
  onTrouble?: (trouble: boolean) => void,
): Promise<AiJobView> {
  return new Promise((resolve) => {
    let stop: StopWatching = () => {}
    stop = watchAiJob(
      id,
      (job) => {
        if (!isJobActive(job)) {
          stop()
          resolve(job)
        }
      },
      onTrouble,
    )
  })
}
