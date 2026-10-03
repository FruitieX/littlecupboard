import type { Product } from './data'
import { awaitAiJob, createAiJob } from './ai-jobs'
import type { IconResult } from './api/IconResult'

export type GeneratedIcon = IconResult
export function needsItemIcon(product: Product) {
  return !product.image && ['', '🛒'].includes(product.icon.trim())
}
export async function generateIconBatches(
  products: Product[],
  onBatch: (icons: GeneratedIcon[]) => void,
  options: {
    proposalId?: string
    scope?: string
    onTrouble?: (trouble: boolean) => void
  } = {},
) {
  // One durable server-side sheet per request; keep completed previews if a
  // later sheet fails. Never regenerate already chosen images in a
  // missing-icons action.
  for (let offset = 0; offset < products.length; offset += 16) {
    const items = products
      .slice(offset, offset + 16)
      .map(({ id, name, category }) => ({ id, name, category }))
    const created = await createAiJob({
      kind: 'sheet',
      scope: options.scope,
      proposalId: options.proposalId,
      items,
    })
    const job = await awaitAiJob(created.jobId, options.onTrouble)
    if (job.status !== 'done' || !job.icons?.length) {
      throw new Error(
        job.error || 'The icons could not be generated. Try again.',
      )
    }
    onBatch(job.icons)
  }
}
