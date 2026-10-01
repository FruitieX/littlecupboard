import { createFileRoute } from '@tanstack/react-router'
import { StoresSettings } from '../components/StoresSettings'
export const Route = createFileRoute('/settings/stores')({
  component: StoresSettings,
})
