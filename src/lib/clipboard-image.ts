import type { ClipboardEvent } from 'react'

const imageTypes = ['image/png', 'image/jpeg', 'image/webp']

/**
 * Reads images from the clipboard through the async Clipboard API, for paste
 * buttons on touch screens where there is no Ctrl+V. Throws a readable error
 * when the browser blocks access or the clipboard holds no image.
 */
export async function readClipboardImages(name: string): Promise<File[]> {
  if (!navigator.clipboard?.read)
    throw new Error('Use Ctrl+V / Cmd+V here, or choose an image file.')
  const files: File[] = []
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((type) => imageTypes.includes(type))
      if (type) files.push(new File([await item.getType(type)], name, { type }))
    }
  } catch {
    throw new Error(
      'Clipboard access was unavailable. Use Ctrl+V / Cmd+V here, or choose a file.',
    )
  }
  if (!files.length) throw new Error('Copy an image first, then paste it here.')
  return files
}

/** Image files from a paste event, e.g. Ctrl+V into a dialog. */
export function pastedImages(event: ClipboardEvent): File[] {
  return [...event.clipboardData.items]
    .filter((item) => item.kind === 'file' && imageTypes.includes(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file)
}
