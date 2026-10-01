import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { useApp } from '../lib/state'
import { changeGroup } from '../lib/groups'
import { Modal } from './ui'

export function GroupEditor({
  group,
  onClose,
}: {
  group: string
  onClose: () => void
}) {
  const { state, update, groups } = useApp()
  const [name, setName] = useState(group)
  const [target, setTarget] = useState(
    groups.find((candidate) => candidate !== group) ?? '',
  )
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  function apply(remove = false) {
    try {
      // Validate the choice before queueing an atomic, undoable household change.
      changeGroup(state, group, remove ? target : name.trim(), remove)
      update((current) =>
        changeGroup(current, group, remove ? target : name.trim(), remove),
      )
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    }
  }
  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title="Edit item group"
        description="Changes update existing items, the catalog, and every shop’s aisle order."
      >
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <label>
            Group name
            <input
              autoFocus
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={!name.trim()}>
            <Check size={16} />
            Save group
          </button>
        </form>
        {groups.length > 1 && (
          <details className="settings-disclosure group-delete">
            <summary>Delete this group</summary>
            <label>
              Move its items to
              <select
                aria-label="Move its items to"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {groups
                  .filter((candidate) => candidate !== group)
                  .map((candidate) => (
                    <option key={candidate}>{candidate}</option>
                  ))}
              </select>
            </label>
            <p className="quiet-label">
              Items and recipes are kept. The group is removed from all shops.
            </p>
            <button
              className="secondary-button danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} />
              Delete group
            </button>
          </details>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </Modal>
      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete group?"
        description={`Move all ${group} items to ${target} and remove ${group} from every shop’s aisle order? Items and recipes are kept.`}
      >
        <div className="modal-actions">
          <button
            className="secondary-button"
            autoFocus
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
          <button
            className="secondary-button danger"
            onClick={() => {
              setConfirmDelete(false)
              apply(true)
            }}
          >
            Delete group
          </button>
        </div>
      </Modal>
    </>
  )
}
