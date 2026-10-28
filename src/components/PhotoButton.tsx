import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  ChevronDown,
  ClipboardPaste,
  Image as ImageIcon,
  LoaderCircle,
} from 'lucide-react'
import { readClipboardImages } from '../lib/clipboard-image'

/**
 * Camera first, gallery when needed: the main button opens the camera and the
 * joined chevron offers "Take photo", "Choose from gallery" or "Paste image".
 */
export function PhotoButton({
  label,
  onFile,
  onError,
  disabled = false,
  busy = false,
  className = '',
}: {
  label: string
  onFile: (file: File) => void
  onError: (message: string) => void
  disabled?: boolean
  busy?: boolean
  className?: string
}) {
  const [menu, setMenu] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])
  const input = (props: { capture?: 'environment'; ariaLabel: string }) => (
    <input
      aria-label={props.ariaLabel}
      type="file"
      accept="image/*"
      capture={props.capture}
      disabled={disabled || busy}
      onChange={(event) => {
        const file = event.target.files?.[0]
        setMenu(false)
        if (file) onFile(file)
        event.target.value = ''
      }}
    />
  )
  return (
    <div
      className={`photo-split ${busy ? 'busy' : ''} ${className}`}
      ref={root}
    >
      <label className="photo-split-main" title={label}>
        {busy ? (
          <LoaderCircle size={20} className="spin" />
        ) : (
          <Camera size={20} />
        )}
        <span className="sr-only">{label}</span>
        {input({ capture: 'environment', ariaLabel: label })}
      </label>
      <button
        type="button"
        className="photo-split-more"
        aria-label="More photo options"
        aria-expanded={menu}
        disabled={disabled || busy}
        onClick={() => setMenu((open) => !open)}
      >
        <ChevronDown size={14} />
      </button>
      {menu && (
        <div className="photo-split-menu" role="menu">
          <label role="menuitem">
            <Camera size={16} /> Take photo
            {input({ capture: 'environment', ariaLabel: 'Take photo' })}
          </label>
          <label role="menuitem">
            <ImageIcon size={16} /> Choose from gallery
            {input({ ariaLabel: 'Choose from gallery' })}
          </label>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false)
              readClipboardImages('Pasted photo').then(
                ([file]) => onFile(file),
                (error: Error) => onError(error.message),
              )
            }}
          >
            <ClipboardPaste size={16} /> Paste image
          </button>
        </div>
      )}
    </div>
  )
}
