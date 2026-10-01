import { useApp } from '../lib/state'
import { SectionTitle } from './ui'
import { AccountSettings } from './AccountSettings'
import { AISettings } from './AISettings'
import { HouseholdSettings } from './HouseholdSettings'
import { useShoppingLayout } from '../lib/shopping-layout'
import { SettingsNavigation } from './SettingsPage'

export function Settings() {
  const { session } = useApp()
  const { groupByCategory, setGroupByCategory } = useShoppingLayout(
    session.user.id,
  )
  return (
    <>
      <div className="page-heading">
        <h1>Settings</h1>
      </div>
      <SettingsNavigation cards />
      <div className="settings-layout">
        <div>
          <section className="settings-card">
            <SectionTitle title="Shopping list" />
            <p className="settings-description">
              Items follow your store’s aisle order. Choose how they appear on
              this device.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={groupByCategory}
                onChange={(e) => setGroupByCategory(e.target.checked)}
              />
              Group by category
            </label>
          </section>
          <HouseholdSettings />
        </div>
        <aside>
          <AISettings />
          <AccountSettings />
        </aside>
      </div>
    </>
  )
}
