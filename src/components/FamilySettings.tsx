import { useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { useApp } from '../lib/state'
import { api } from '../lib/http'
import { SectionTitle } from './ui'

export function FamilySettings() {
  const { session, refreshSession, status } = useApp()
  const [name, setName] = useState(session.householdName)
  const [original, setOriginal] = useState(session.householdName)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setBusy(true)
    setError('')
    try {
      await api('/household', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), expectedName: original }),
      })
      await refreshSession()
      setOriginal(name.trim())
      setSaved(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="settings-card">
      <SectionTitle title="Our family" />
      {session.user.role === 'owner' ? (
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label>
            Family name
            <input
              required
              maxLength={80}
              value={name}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value)
                setSaved(false)
              }}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || status === 'offline' || !name.trim()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : saved ? (
              <Check size={16} />
            ) : null}
            {saved ? 'Family name saved' : 'Save family name'}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="settings-description">{session.householdName}</p>
      )}
    </section>
  )
}
