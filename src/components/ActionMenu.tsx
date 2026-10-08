import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export type MenuAction = {
  label: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
}

/**
 * A compact "More" button for secondary actions. The menu is portaled so
 * collapsing panels never clip it, and opens upwards near the screen edge.
 */
export function ActionMenu({
  label,
  actions,
}: {
  /** Accessible name, for example "More for Milk". */
  label: string
  actions: MenuAction[]
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{
    top?: number
    bottom?: number
    right: number
  }>({ right: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const place = useCallback(() => {
    if (!button.current) return
    const rect = button.current.getBoundingClientRect()
    const right = Math.max(8, window.innerWidth - rect.right)
    const height = menu.current?.offsetHeight ?? 0
    setPosition(
      rect.bottom + 6 + height > window.innerHeight - 8
        ? { bottom: window.innerHeight - rect.top + 6, right }
        : { top: rect.bottom + 6, right },
    )
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    place()
    menu.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true })
  }, [open, place])
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target))
        setOpen(false)
    }
    // Follow the button while the page scrolls.
    document.addEventListener('pointerdown', close)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])
  return (
    <>
      <button
        ref={button}
        type="button"
        className="chip-button icon-chip"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={17} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="action-menu"
            role="menu"
            aria-label={label}
            style={position}
            onKeyDown={(event) => {
              const items = [
                ...(menu.current?.querySelectorAll<HTMLElement>(
                  '[role="menuitem"]',
                ) ?? []),
              ]
              const index = items.indexOf(document.activeElement as HTMLElement)
              if (event.key === 'Escape') {
                setOpen(false)
                button.current?.focus()
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                items[(index + step + items.length) % items.length]?.focus()
              } else if (event.key === 'Tab') setOpen(false)
            }}
          >
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                className={action.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false)
                  action.onSelect()
                }}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
