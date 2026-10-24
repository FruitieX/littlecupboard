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
  // Lifting the finger after a hold still fires a click, now aimed at
  // whatever the editor opened beneath it, such as a checkbox. Swallow the
  // click that follows the release, however long the finger stayed down.
  function held() {
    edit()
    // Some browsers send no click after a long press; stop shortly after
    // the release so the next real tap still works.
    const release = () => setTimeout(stop, 400)
    const swallow = (event: globalThis.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      stop()
    }
    const stop = () => {
      for (const type of ['pointerup', 'pointercancel'])
        document.removeEventListener(type, release, true)
      document.removeEventListener('click', swallow, true)
    }
    for (const type of ['pointerup', 'pointercancel'])
      document.addEventListener(type, release, { capture: true, once: true })
    document.addEventListener('click', swallow, true)
    setTimeout(stop, 10000)
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
        timer.current = setTimeout(held, 500)
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
