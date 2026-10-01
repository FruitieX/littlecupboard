import { useState } from 'react'
import { Check } from 'lucide-react'
import { useApp } from '../lib/state'
import { SectionTitle } from './ui'
import { FamilySettings } from './FamilySettings'
export function HouseholdSettings() {
  const { state, update } = useApp()
  const [saved, setSaved] = useState(false)
  const preferences = state.preferences!
  return (
    <>
      <FamilySettings />
      <section className="settings-card">
        <SectionTitle title="Our kitchen preferences" />
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            update((s) => ({
              ...s,
              preferences: {
                ...s.preferences!,
                servings: Number(data.get('servings')),
                timeZone: String(data.get('timeZone')),
                maxWeekdayMinutes: Number(data.get('minutes')),
                novelty: Number(data.get('novelty')),
                dietary: String(data.get('dietary'))
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
                avoid: String(data.get('avoid'))
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
            }))
            setSaved(true)
          }}
        >
          <div className="form-row">
            <label>
              Usual servings
              <input
                name="servings"
                type="number"
                required
                min={1}
                max={100}
                defaultValue={preferences.servings}
              />
            </label>
            <label>
              Weekday minutes
              <input
                name="minutes"
                type="number"
                min={1}
                max={1440}
                required
                defaultValue={preferences.maxWeekdayMinutes}
              />
            </label>
          </div>
          <label>
            Dietary preferences
            <input
              name="dietary"
              defaultValue={preferences.dietary.join(', ')}
              placeholder="Vegetarian, gluten-free…"
              maxLength={500}
            />
          </label>
          <label>
            Ingredients to avoid
            <input
              name="avoid"
              defaultValue={preferences.avoid.join(', ')}
              placeholder="e.g. peanuts, mushrooms"
              maxLength={1000}
            />
          </label>
          <label>
            How adventurous?{' '}
            <input
              aria-label="How adventurous"
              name="novelty"
              type="range"
              min={0}
              max={1}
              step="0.1"
              defaultValue={preferences.novelty}
            />
            <small>Familiar favorites → more new ideas</small>
          </label>
          <label>
            Household time zone
            <input
              name="timeZone"
              required
              defaultValue={preferences.timeZone}
              maxLength={100}
            />
          </label>
          <button className="secondary-button">
            {saved && <Check size={16} />}{' '}
            {saved ? 'Preferences saved' : 'Save preferences'}
          </button>
        </form>
      </section>
    </>
  )
}
