import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp } from '../lib/state'
import { SectionTitle } from './ui'
import { SettingsPage } from './SettingsPage'
import { GroupEditor } from './GroupEditor'
export function GroupsSettings() {
  const { update, groups } = useApp()
  const [group, setGroup] = useState('')
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  return (
    <SettingsPage
      title="Item groups"
      description="Organize your catalog and shop aisles."
    >
      <section className="settings-card">
        <SectionTitle title="Groups" />
        <p className="settings-description">
          Every shop has its own route. New groups are available to add in
          Stores.
        </p>
        <div className="group-list">
          {groups.map((g) => (
            <button
              className="group-chip"
              key={g}
              aria-label={`Edit group ${g}`}
              onClick={() => setEditingGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault()
            const name = group.trim()
            if (
              !name ||
              groups.some((g) => g.toLowerCase() === name.toLowerCase())
            )
              return
            update((s) => ({
              ...s,
              groups: [...(s.groups ?? []), name],
            }))
            setGroup('')
          }}
        >
          <label>
            New group
            <input
              value={group}
              maxLength={60}
              required
              onChange={(e) => setGroup(e.target.value)}
            />
          </label>
          <button className="secondary-button">
            <Plus size={15} /> Add group
          </button>
        </form>
      </section>
      {editingGroup && (
        <GroupEditor
          key={editingGroup}
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
        />
      )}
    </SettingsPage>
  )
}
