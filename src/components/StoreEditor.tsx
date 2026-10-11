import { useState } from 'react'
import { Check, LocateFixed, Plus } from 'lucide-react'
import { useApp } from '../lib/state'
import type { Store } from '../lib/data'
import { Modal } from './ui'
import { ImageField } from './ImageField'
import { AisleOrder } from './AisleOrder'
import { StoreMapAssistant } from './StoreMapAssistant'
import { currentPosition, formatPoint, parsePoint } from '../lib/geo'

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
  const [position, setPosition] = useState(formatPoint(store?.position))
  const [locating, setLocating] = useState(false)
  const [positionError, setPositionError] = useState('')
  const point = parsePoint(position)
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
          if (busy || !name.trim() || point === null) return
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
                        ...(JSON.stringify(point) !==
                        JSON.stringify(store.position)
                          ? { position: point }
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
                    ...(point ? { position: point } : {}),
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
        <div className="store-position">
          <label>
            Map position
            <span className="optional">
              Opens the app on this shop when you are nearby
            </span>
            <input
              inputMode="decimal"
              value={position}
              aria-invalid={point === null}
              onChange={(event) => {
                setPosition(event.target.value)
                setPositionError('')
              }}
              placeholder="Latitude, longitude"
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={locating}
            onClick={async () => {
              setLocating(true)
              setPositionError('')
              try {
                const { coords } = await currentPosition(20000)
                setPosition(
                  formatPoint({ lat: coords.latitude, lng: coords.longitude }),
                )
              } catch (error) {
                setPositionError(
                  error instanceof GeolocationPositionError &&
                    error.code === error.PERMISSION_DENIED
                    ? 'Location access is blocked for this site.'
                    : 'Could not find your location. Try again or paste coordinates.',
                )
              } finally {
                setLocating(false)
              }
            }}
          >
            <LocateFixed size={16} />
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          {(positionError || point === null) && (
            <p className="form-error" role="alert">
              {positionError ||
                'Enter latitude and longitude, e.g. 60.1699, 24.9384.'}
            </p>
          )}
        </div>
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
          disabled={busy || !name.trim() || point === null}
        >
          {store ? <Check size={18} /> : <Plus size={18} />}
          {store ? 'Save shop' : 'Add store'}
        </button>
      </form>
    </Modal>
  )
}
