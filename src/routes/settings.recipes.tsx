import { createFileRoute } from '@tanstack/react-router'
import { LibrarySettings } from '../components/LibrarySettings'
import { SettingsPage } from '../components/SettingsPage'
export const Route = createFileRoute('/settings/recipes')({
  component: () => (
    <SettingsPage title="Recipes">
      <LibrarySettings section="recipes" />
    </SettingsPage>
  ),
})
