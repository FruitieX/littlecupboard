import { createFileRoute } from '@tanstack/react-router'
import { LibrarySettings } from '../components/LibrarySettings'
import { SettingsPage } from '../components/SettingsPage'
export const Route = createFileRoute('/settings/items')({
  component: () => (
    <SettingsPage title="Items">
      <LibrarySettings section="items" />
    </SettingsPage>
  ),
})
