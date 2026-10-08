import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { awaitAiJob, createAiJob, isJobActive, watchAiJob } from './ai-jobs'
import type { AiJobView } from './ai-jobs'

function job(overrides: Partial<AiJobView> = {}): AiJobView {
  return {
    id: 'job-1',
    status: 'queued',
    kind: 'recipe',
    scope: '',
    proposalId: null,
    recipeId: null,
    productId: null,
    url: null,
    icons: null,
    name: null,
    error: null,
    createdAt: 1700000000,
    ...overrides,
  }
}

let responses: (unknown | Error)[] = []
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  responses = []
  fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('durable AI generation jobs', () => {
  it('follows a finished job and stops polling', async () => {
    responses = [
      { jobs: [job({ status: 'running' })] },
      { jobs: [job({ status: 'done', url: '/api/images/1' })] },
    ]
    const updates: string[] = []
    const stop = watchAiJob('job-1', (entry) => updates.push(entry.status))
    await vi.advanceTimersByTimeAsync(0)
    expect(updates).toEqual(['running'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(updates).toEqual(['running', 'done'])
    const calls = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchMock.mock.calls.length).toBe(calls)
    stop()
  })

  it('keeps retrying through a dropped connection without failing', async () => {
    responses = [
      new TypeError('Failed to fetch'),
      new TypeError('Failed to fetch'),
      { jobs: [job({ status: 'done', url: '/api/images/2' })] },
    ]
    const troubles: boolean[] = []
    const updates: string[] = []
    const stop = watchAiJob(
      'job-1',
      (entry) => updates.push(entry.status),
      (trouble) => troubles.push(trouble),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(troubles).toEqual([true])
    expect(updates).toEqual([])
    await vi.advanceTimersByTimeAsync(3200)
    expect(troubles).toEqual([true, true])
    await vi.advanceTimersByTimeAsync(6500)
    expect(troubles).toEqual([true, true, false])
    expect(updates).toEqual(['done'])
    stop()
  })

  it('resolves a watched job once it reaches a terminal state', async () => {
    responses = [
      { jobs: [job({ status: 'failed', error: 'Quota exhausted' })] },
    ]
    const promise = awaitAiJob('job-1')
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise
    expect(result.status).toBe('failed')
    expect(result.error).toBe('Quota exhausted')
  })

  it('sends a retryable request id and explicit nulls when creating jobs', async () => {
    responses = [{ jobId: 'job-9', status: 'queued' }]
    const created = await createAiJob({
      kind: 'sheet',
      scope: 'recipe:1',
      items: [{ id: 'apples', name: 'Apples', category: 'Fruits' }],
      requestId: 'request-9',
    })
    expect(created.jobId).toBe('job-9')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ai/jobs')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      requestId: 'request-9',
      scope: 'recipe:1',
      kind: 'sheet',
      prompt: '',
      proposalId: null,
      recipeId: null,
      productId: null,
      items: [{ id: 'apples', name: 'Apples', category: 'Fruits' }],
    })
  })

  it('treats queued and running as active only', () => {
    expect(isJobActive(job({ status: 'queued' }))).toBe(true)
    expect(isJobActive(job({ status: 'running' }))).toBe(true)
    for (const status of ['done', 'failed', 'canceled'])
      expect(isJobActive(job({ status }))).toBe(false)
  })
})
