import { createFileRoute } from '@tanstack/react-router'
import { GroupsSettings } from '../components/GroupsSettings'
export const Route = createFileRoute('/settings/groups')({
  component: GroupsSettings,
})
