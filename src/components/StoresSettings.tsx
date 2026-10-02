import { useState } from 'react'
import { Check, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../lib/state'
import { Modal, SectionTitle } from './ui'
import { SettingsPage } from './SettingsPage'
import { StoreEditor } from './StoreEditor'
import { AisleOrder } from './AisleOrder'
import type { Store } from '../lib/data'

export function StoresSettings() {
  const { state, update, groups } = useApp()
  const [storeId, setStoreId] = useState<string | null>(null)
  const [editor, setEditor] = useState<Store | 'new' | null>(null)
  const [removeStore, setRemoveStore] = useState<Store | null>(null)
  const store =
    state.stores.find((s) => s.id === (storeId ?? state.storeId)) ??
    state.stores[0]
  return (
    <>
      <SettingsPage
        title="Stores"
        description="Favorite shops, pictures and aisle order."
      >
        <div className="stores-settings-layout">
          <div>
            <section className="settings-card">
              <SectionTitle title="Our favorite stores">
                <button
                  className="text-button"
                  onClick={() => setEditor('new')}
                >
                  <Plus size={16} />
                  Add store
                </button>
              </SectionTitle>
              <p className="settings-description">
                Different store, different route. Keep your list in aisle order.
              </p>
              <div className="store-list">
                {state.stores.map((s) => (
                  <button
                    key={s.id}
                    className={`store-option ${store.id === s.id ? 'selected' : ''}`}
                    onClick={() => setStoreId(s.id)}
                  >
                    <span className="store-option-icon">
                      {s.image ? (
                        <img src={s.image} alt="" />
                      ) : (
                        <MapPin size={20} />
                      )}
                    </span>
                    <span>
                      <strong>{s.name}</strong>
                      <small>{s.location || 'Our favorite shop'}</small>
                    </span>
                    {store.id === s.id && <Check size={18} />}
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-card aisle-card">
              <SectionTitle title={`${store.name} · aisle order`}>
                <button
                  className="text-button"
                  onClick={() => setEditor(store)}
                >
                  <Pencil size={16} /> Edit shop
                </button>
                <span className="saved-label">
                  <Check size={13} />
                  Saved
                </span>
              </SectionTitle>
              <p className="settings-description">
                Choose the aisles in this shop and match your usual route. Items
                from other groups stay visible at the end of the list.
              </p>
              <AisleOrder
                order={store.order}
                groups={groups}
                onChange={(order) =>
                  update((current) => ({
                    ...current,
                    stores: current.stores.map((entry) =>
                      entry.id === store.id ? { ...entry, order } : entry,
                    ),
                  }))
                }
              />
              {state.stores.length > 1 && (
                <button
                  className="text-button danger remove-store"
                  onClick={() => setRemoveStore(store)}
                >
                  <Trash2 size={15} />
                  Remove {store.name}
                </button>
              )}
            </section>
          </div>
        </div>
      </SettingsPage>
      {editor && (
        <StoreEditor
          key={editor === 'new' ? 'new' : editor.id}
          store={editor === 'new' ? undefined : editor}
          onClose={(id) => {
            setEditor(null)
            if (id) setStoreId(id)
          }}
        />
      )}
      <Modal
        open={!!removeStore}
        onOpenChange={(open) => {
          if (!open) setRemoveStore(null)
        }}
        title="Remove shop?"
        description={`Remove ${removeStore?.name ?? 'this shop'} and its aisle order for your family? Shopping items and purchase history are kept.`}
      >
        <div className="modal-actions">
          <button
            className="secondary-button"
            autoFocus
            onClick={() => setRemoveStore(null)}
          >
            Cancel
          </button>
          <button
            className="secondary-button danger"
            disabled={state.stores.length <= 1}
            onClick={() => {
              if (!removeStore) return
              const fallback = state.stores.find(
                (entry) => entry.id !== removeStore.id,
              )
              if (!fallback) return
              update((current) => {
                const stores = current.stores.filter(
                  (entry) => entry.id !== removeStore.id,
                )
                if (!stores.length) return current
                return {
                  ...current,
                  stores,
                  storeId:
                    current.storeId === removeStore.id
                      ? stores[0].id
                      : current.storeId,
                }
              })
              setStoreId(fallback.id)
              setRemoveStore(null)
            }}
          >
            Remove shop
          </button>
        </div>
      </Modal>
    </>
  )
}
