import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'

export function HoldButton({
  onPress,
  onHold,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  onPress: () => void
  onHold: () => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const ignoreClickUntil = useRef(0)
  function cancel() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
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
      type="button"
      title="Hold to edit · right-click or Shift+F10 on desktop"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        cancel()
        start.current = { x: event.clientX, y: event.clientY }
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
        onPress()
      }}
    />
  )
}
