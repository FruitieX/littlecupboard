import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

function formValues(form: HTMLFormElement) {
  return JSON.stringify(
    [
      ...form.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('input, textarea, select'),
    ].map((field) => [
      field.value,
      field instanceof HTMLInputElement ? field.checked : null,
    ]),
  )
}

export function AppUpdate() {
  const [available, setAvailable] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const registration = useRef<ServiceWorkerRegistration | null>(null)
  const requested = useRef(false)
  const changed = useRef(false)
  const dirtyForms = useRef(new Map<HTMLFormElement, string>())
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    const workers = new Map<ServiceWorker, () => void>()
    const container = navigator.serviceWorker
    let controlled = !!container.controller
    let disposed = false
    let lastCheck = 0
    function watch(worker: ServiceWorker | null) {
      if (!worker || workers.has(worker)) return
      const onState = () => {
        if (worker.state === 'installed' && registration.current?.active)
          setAvailable(true)
      }
      workers.set(worker, onState)
      worker.addEventListener('statechange', onState)
      onState()
    }
    function found() {
      watch(registration.current?.installing ?? null)
    }
    function controllerChanged() {
      if (controlled) {
        changed.current = true
        if (requested.current) window.location.reload()
        else setAvailable(true)
      }
      controlled = true
    }
    function check() {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      if (Date.now() - lastCheck < 30000) return
      lastCheck = Date.now()
      void registration.current?.update().catch(() => {})
    }
    function markDirty(event: Event) {
      for (const form of dirtyForms.current.keys())
        if (!form.isConnected) dirtyForms.current.delete(form)
      const form = (event.target as HTMLElement).closest('form')
      if (form && !dirtyForms.current.has(form))
        dirtyForms.current.set(form, formValues(form))
    }
    container.addEventListener('controllerchange', controllerChanged)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    document.addEventListener('focusin', markDirty)
    const interval = setInterval(check, 5 * 60 * 1000)
    void container.register('/sw.js', { updateViaCache: 'none' }).then(
      (value) => {
        if (disposed) return
        registration.current = value
        value.addEventListener('updatefound', found)
        if (value.waiting) setAvailable(true)
        watch(value.installing)
        check()
      },
      () => {},
    )
    return () => {
      disposed = true
      clearInterval(interval)
      clearTimeout(reloadTimer.current)
      registration.current?.removeEventListener('updatefound', found)
      for (const [worker, listener] of workers)
        worker.removeEventListener('statechange', listener)
      container.removeEventListener('controllerchange', controllerChanged)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
      document.removeEventListener('focusin', markDirty)
    }
  }, [])

  if (!available) return null
  return (
    <aside className="app-update" aria-label="App update">
      <span role="status">{error || 'New version available'}</span>
      <button
        className="text-button"
        disabled={updating}
        onClick={() => {
          if (
            [...dirtyForms.current].some(
              ([form, initial]) =>
                form.isConnected && formValues(form) !== initial,
            ) &&
            !window.confirm(
              'Reload the app? Unsaved form edits will be lost. Shopping changes saved on this device are kept.',
            )
          )
            return
          setError('')
          const worker = registration.current?.waiting
          if (changed.current || !worker) {
            window.location.reload()
            return
          }
          requested.current = true
          setUpdating(true)
          clearTimeout(reloadTimer.current)
          reloadTimer.current = setTimeout(() => {
            requested.current = false
            setUpdating(false)
            setError('Could not load the update. Try again.')
          }, 10000)
          worker.postMessage({ type: 'ACTIVATE_UPDATE' })
        }}
      >
        <RefreshCw size={16} /> {updating ? 'Updating…' : 'Reload app'}
      </button>
    </aside>
  )
}
