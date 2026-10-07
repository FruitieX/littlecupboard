import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, MouseEvent } from 'react'

export function HoldButton({
  onPress,
  onHold,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  onPress: (event: MouseEvent<HTMLButtonElement>) => void
  onHold: () => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const ignoreClickUntil = useRef(0)
  const element = useRef<HTMLButtonElement>(null)
  // Pressing state lives in a data attribute so CSS can show the hold
  // building up without re-rendering React on every touch.
  function cancel() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
    delete element.current?.dataset.pressing
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  function edit() {
    cancel()
    ignoreClickUntil.current = Date.now() + 800
    onHold()
  }
  return (
    <button
      {...props}
      ref={element}
      type="button"
      title="Hold to edit · right-click or Shift+F10 on desktop"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        cancel()
        start.current = { x: event.clientX, y: event.clientY }
        event.currentTarget.dataset.pressing = 'true'
        timer.current = setTimeout(edit, 500)
      }}
      onPointerMove={(event) => {
        if (
          start.current &&
          Math.hypot(
            event.clientX - start.current.x,
            event.clientY - start.current.y,
          ) > 10
        )
          cancel()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => {
        event.preventDefault()
        edit()
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'ContextMenu' ||
          (event.shiftKey && event.key === 'F10')
        ) {
          event.preventDefault()
          edit()
        }
      }}
      onClick={(event) => {
        if (Date.now() < ignoreClickUntil.current) {
          event.preventDefault()
          return
        }
        onPress(event)
      }}
    />
  )
}
