import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useApp } from '../lib/state'
import type { Store } from '../lib/data'
import { Modal } from './ui'
import { ImageField } from './ImageField'

export function StoreEditor({
  store,
  onClose,
}: {
  store?: Store
  onClose: (id?: string) => void
}) {
  const { update } = useApp()
  const [name, setName] = useState(store?.name ?? '')
  const [location, setLocation] = useState(store?.location ?? '')
  const [image, setImage] = useState(store?.image ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
      title={store ? 'Edit shop' : 'Another favorite shop'}
      description="Name, location reminder, and an optional picture. Aisle order is saved separately."
    >
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (busy || !name.trim()) return
          const id = store?.id ?? crypto.randomUUID()
          update((state) => ({
            ...state,
            stores: store
              ? state.stores.map((current) =>
                  current.id === store.id
                    ? {
                        ...current,
                        ...(name !== store.name ? { name: name.trim() } : {}),
                        ...(location !== store.location
                          ? { location: location.trim() }
                          : {}),
                        ...(image !== (store.image ?? '')
                          ? { image: image || undefined }
                          : {}),
                      }
                    : current,
                )
              : [
                  ...state.stores,
                  {
                    id,
                    name: name.trim(),
                    location: location.trim(),
                    image: image || undefined,
                    order: [...(state.groups ?? [])],
                  },
                ],
          }))
          onClose(id)
        }}
      >
        <label>
          Store name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. The corner shop"
          />
        </label>
        <label>
          Location or reminder
          <input
            maxLength={120}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="e.g. On the way home"
          />
        </label>
        <ImageField
          kind="store"
          subject={name}
          value={image}
          onChange={setImage}
          onBusyChange={setBusy}
        />
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !name.trim()}
        >
          {store ? <Check size={18} /> : <Plus size={18} />}
          {store ? 'Save shop' : 'Add store'}
        </button>
      </form>
    </Modal>
  )
}
