import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  MapPin,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  HardDrive,
  RefreshCw,
} from 'lucide-react'
import { useApp } from '../lib/state'
import { APP_NAME } from '../lib/brand'
import { Eyebrow, Modal, SectionTitle } from './ui'
import { FoodIcon } from './FoodIcon'
import { AccountSettings } from './AccountSettings'
import { AISettings } from './AISettings'
import { HouseholdSettings } from './HouseholdSettings'
import { useShoppingLayout } from '../lib/shopping-layout'

export function Settings() {
  const { state, update, session } = useApp()
  const { groupByCategory, setGroupByCategory } = useShoppingLayout(
    session.user.id,
  )
  const [storeId, setStoreId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const store =
    state.stores.find((s) => s.id === (storeId ?? state.storeId)) ??
    state.stores[0]
  function move(index: number, direction: number) {
    update((s) => ({
      ...s,
      stores: s.stores.map((current) => {
        if (current.id !== store.id) return current
        const order = [...current.order]
        ;[order[index], order[index + direction]] = [
          order[index + direction],
          order[index],
        ]
        return { ...current, order }
      }),
    }))
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <Eyebrow>A BASKET THAT FITS YOUR LIFE</Eyebrow>
          <h1>
            Make it yours<span className="heading-dot">.</span>
          </h1>
          <p>A little setup. A much smoother shop.</p>
        </div>
        <Settings2
          className="settings-heading-icon"
          size={38}
          strokeWidth={1.2}
        />
      </div>
      <div className="settings-layout">
        <div>
          <section className="settings-card">
            <SectionTitle title="Shopping list" />
            <p className="settings-description">
              Items always follow your store’s aisle order. Choose how they
              appear on this device.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={groupByCategory}
                onChange={(event) => setGroupByCategory(event.target.checked)}
              />
              Group by category
            </label>
          </section>
          <section className="settings-card">
            <SectionTitle title="Our favorite stores">
              <button className="text-button" onClick={() => setAddOpen(true)}>
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
                    <MapPin size={20} />
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
              <span className="saved-label">
                <Check size={13} />
                Saved
              </span>
            </SectionTitle>
            <p className="settings-description">
              Move the groups to match your usual route through the store.
            </p>
            <ol className="aisle-list">
              {store.order.map((category, index) => (
                <li key={category}>
                  <span className="aisle-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <strong>{category}</strong>
                  <div>
                    <button
                      className="icon-button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${category} up`}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={index === store.order.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${category} down`}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {state.stores.length > 1 && (
              <button
                className="text-button danger remove-store"
                onClick={() => {
                  update((s) => ({
                    ...s,
                    stores: s.stores.filter((x) => x.id !== store.id),
                    storeId:
                      s.storeId === store.id
                        ? s.stores.find((x) => x.id !== store.id)!.id
                        : s.storeId,
                  }))
                  setStoreId(state.stores.find((x) => x.id !== store.id)!.id)
                }}
              >
                <Trash2 size={15} />
                Remove {store.name}
              </button>
            )}
          </section>
        </div>
        <aside>
          <HouseholdSettings />
          <AISettings />
          <AccountSettings />
          <div className="settings-signoff">
            <span>
              <FoodIcon value="🌿" />
            </span>
            <h3>{APP_NAME}</h3>
            <p>Good food. Less fuss.</p>
            <small>Your shared family kitchen</small>
          </div>
        </aside>
      </div>
      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Another favorite shop"
        description="Add a store, then arrange its groups to match your usual route."
      >
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault()
            const id = crypto.randomUUID()
            update((s) => ({
              ...s,
              stores: [
                ...s.stores,
                {
                  id,
                  name: newName.trim(),
                  location: newLocation.trim(),
                  order: [...(s.groups ?? [])],
                },
              ],
            }))
            setStoreId(id)
            setAddOpen(false)
            setNewName('')
            setNewLocation('')
          }}
        >
          <label>
            Store name
            <input
              autoFocus
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={60}
              placeholder="e.g. The corner shop"
            />
          </label>
          <label>
            A little reminder
            <input
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              maxLength={100}
              placeholder="e.g. A quick stop on the way home"
            />
          </label>
          <button type="submit" className="primary-button">
            <Plus size={18} />
            Add store
          </button>
        </form>
      </Modal>
    </>
  )
}
