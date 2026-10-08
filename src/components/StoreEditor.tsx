import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useApp } from '../lib/state'
import type { Store } from '../lib/data'
import { Modal } from './ui'
import { ImageField } from './ImageField'
import { AisleOrder } from './AisleOrder'
import { StoreMapAssistant } from './StoreMapAssistant'

export function StoreEditor({
  store,
  onClose,
}: {
  store?: Store
  onClose: (id?: string) => void
}) {
  const { update, groups } = useApp()
  const [name, setName] = useState(store?.name ?? '')
  const [location, setLocation] = useState(store?.location ?? '')
  const [image, setImage] = useState(store?.image ?? '')
  const [order, setOrder] = useState(store?.order ?? [...groups])
  const [pictureBusy, setPictureBusy] = useState(false)
  const [mapBusy, setMapBusy] = useState(false)
  const busy = pictureBusy || mapBusy
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
      title={store ? 'Edit shop' : 'Another favorite shop'}
      description="Shop details and the aisles along your route."
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
                        ...(JSON.stringify(order) !==
                        JSON.stringify(store.order)
                          ? {
                              order: order.filter((group) =>
                                (state.groups ?? []).includes(group),
                              ),
                            }
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
                    order: order.filter((group) =>
                      (state.groups ?? []).includes(group),
                    ),
                  },
                ],
          }))
          onClose(id)
        }}
      >
        <label>
          Store name
          <input
            autoFocus={!store}
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
          scope={store?.id ? `store:${store.id}` : ''}
          subject={name}
          value={image}
          onChange={setImage}
          onBusyChange={setPictureBusy}
        />
        <StoreMapAssistant
          name={name}
          location={location}
          order={order}
          onApply={setOrder}
          onBusyChange={setMapBusy}
          disabled={pictureBusy}
        />
        <details className="store-aisle-details">
          <summary>Aisles in this shop · {order.length}</summary>
          <p className="quiet-label">
            Add, remove or reorder groups. Other items stay visible at the end
            of your shopping list.
          </p>
          <AisleOrder
            order={order.filter((group) => groups.includes(group))}
            groups={groups}
            onChange={setOrder}
          />
        </details>
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
