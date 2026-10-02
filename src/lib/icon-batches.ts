import type { Product } from './data'
import { post } from './http'
import type { IconResult } from './api/IconResult'
import type { IconBatchResponse } from './api/IconBatchResponse'

export type GeneratedIcon = IconResult
export function needsItemIcon(product: Product) {
  return !product.image && ['', '🛒'].includes(product.icon.trim())
}
export async function generateIconBatches(
  products: Product[],
  onBatch: (icons: GeneratedIcon[]) => void,
  proposalId?: string,
) {
  // One provider request per sheet; keep completed previews if a later sheet
  // fails. Never regenerate already chosen images in a missing-icons action.
  for (let offset = 0; offset < products.length; offset += 16) {
    const items = products
      .slice(offset, offset + 16)
      .map(({ id, name, category }) => ({ id, name, category }))
    const result = await post<IconBatchResponse>('/ai/icon-batch', {
      items,
      ...(proposalId ? { proposalId } : {}),
    })
    onBatch(result.icons)
  }
}
