import { createFileRoute, Outlet } from '@tanstack/react-router'
import { LittleCupboard } from '../components/LittleCupboard'
export const Route = createFileRoute('/settings')({
  component: () => (
    <LittleCupboard view="settings">
      <Outlet />
    </LittleCupboard>
  ),
})
